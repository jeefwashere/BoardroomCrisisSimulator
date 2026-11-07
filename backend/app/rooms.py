"""Single process room owner. Credentials and receipts never enter snapshots."""

import asyncio
from dataclasses import dataclass, field
import secrets
from uuid import UUID, uuid4

from .models import CreateRoom, JoinRoom, MemberView, RoomView


class RoomError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


@dataclass
class Room:
    room_id: UUID
    code: str
    host_member_id: UUID
    members: dict[str, MemberView]
    version: int = 1
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def snapshot(self, session: str) -> RoomView:
        member = self.members.get(session)
        if member is None:
            raise RoomError(403, "not_a_member", "Join this room before reading it")
        return RoomView(
            room_id=self.room_id,
            room_code=self.code,
            room_version=self.version,
            host_member_id=self.host_member_id,
            self_member_id=member.member_id,
            members=list(self.members.values()),
        )


class Rooms:
    def __init__(self):
        self.sessions: set[str] = set()
        self.rooms: dict[UUID, Room] = {}
        self.codes: dict[str, UUID] = {}
        self.receipts: dict[tuple[str, UUID], tuple[tuple, RoomView]] = {}
        self.creation_lock = asyncio.Lock()

    def session(self, cookie: str | None) -> str:
        if cookie in self.sessions:
            return cookie
        token = secrets.token_urlsafe(32)
        self.sessions.add(token)
        return token

    def authenticate(self, cookie: str | None) -> str:
        if cookie not in self.sessions:
            raise RoomError(401, "session_required", "Initialize GET /api/session first")
        return cookie

    def retry(self, session: str, command_id: UUID, intent: tuple) -> RoomView | None:
        receipt = self.receipts.get((session, command_id))
        if receipt is None:
            return None
        previous_intent, view = receipt
        if intent != previous_intent:
            raise RoomError(409, "command_conflict", "Use a new command_id for a different request")
        return view

    async def create(self, session: str, request: CreateRoom) -> RoomView:
        intent = ("create", request.display_name)
        async with self.creation_lock:
            if previous := self.retry(session, request.command_id, intent):
                return previous
            alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            code = "".join(secrets.choice(alphabet) for _ in range(6))
            while code in self.codes:
                code = "".join(secrets.choice(alphabet) for _ in range(6))
            host = MemberView(member_id=uuid4(), display_name=request.display_name, is_host=True)
            room = Room(uuid4(), code, host.member_id, {session: host})
            self.rooms[room.room_id] = room
            self.codes[code] = room.room_id
            view = room.snapshot(session)
            self.receipts[(session, request.command_id)] = (intent, view)
            return view

    async def join(self, session: str, request: JoinRoom) -> RoomView:
        intent = ("join", request.room_code, request.display_name)
        room_id = self.codes.get(request.room_code)
        if room_id is None:
            # Check receipt reuse even when the replacement code does not exist.
            self.retry(session, request.command_id, intent)
            raise RoomError(404, "room_not_found", "Room code was not found")
        room = self.rooms[room_id]
        async with room.lock:
            if previous := self.retry(session, request.command_id, intent):
                return previous
            existing = room.members.get(session)
            if existing is not None:
                if existing.display_name.casefold() != request.display_name.casefold():
                    raise RoomError(409, "already_joined", "This browser already has a seat; renaming is not supported")
            else:
                if any(member.display_name.casefold() == request.display_name.casefold()
                       for member in room.members.values()):
                    raise RoomError(409, "name_taken", "Choose another display name")
                if len(room.members) >= 20:
                    raise RoomError(409, "room_full", "This room already has 20 members")
                room.members[session] = MemberView(
                    member_id=uuid4(), display_name=request.display_name, is_host=False,
                )
                room.version += 1
            view = room.snapshot(session)
            self.receipts[(session, request.command_id)] = (intent, view)
            return view

    async def snapshot(self, session: str, room_id: UUID) -> RoomView:
        room = self.rooms.get(room_id)
        if room is None:
            raise RoomError(404, "room_not_found", "Room was not found")
        async with room.lock:
            return room.snapshot(session)
