"""Single process mutation owner with immutable phases and receipts."""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
import secrets
import time
from uuid import UUID, uuid4

from .rules import MINIMUM_TO_START, PRESENCE_WINDOW_SECONDS, ROOM_CAPACITY
from .scenarios import PublicDocument, Scenario, ScenarioCatalog, Timing


class RoomError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Seat:
    member_id: UUID
    display_name: str
    last_seen: float


@dataclass(frozen=True)
class Assignment:
    member_id: UUID
    role_id: str
    eligible_from_round: int


@dataclass(frozen=True)
class Lobby:
    pass


@dataclass(frozen=True)
class Briefing:
    phase_id: UUID
    started_at: datetime
    scenario: Scenario
    timing: Timing
    assignments: tuple[Assignment, ...]
    round_number: int = 1


@dataclass(frozen=True)
class StartSpec:
    room_code: str
    scenario_id: str
    scenario_version: int
    timing_profile: str
    players: tuple[tuple[UUID, str], ...]


@dataclass(frozen=True)
class MemberSnapshot:
    member_id: UUID
    display_name: str
    is_host: bool
    connected: bool
    role_id: str | None
    eligible_from_round: int | None
    eligible_current_round: bool


@dataclass(frozen=True)
class ScenarioIdentity:
    scenario_id: str
    version: int
    title: str
    content_sha256: str


@dataclass(frozen=True)
class BriefingSnapshot:
    phase_id: UUID
    round_number: int
    started_at: datetime
    scenario: ScenarioIdentity
    timing_profile: str
    briefing_seconds: int
    initial_node_id: str
    metrics: tuple[tuple[str, int], ...]
    public_documents: tuple[PublicDocument, ...]
    eligible_member_ids: tuple[UUID, ...]

    @property
    def initial_metrics(self) -> dict[str, int]:
        return dict(self.metrics)


@dataclass(frozen=True)
class RoomSnapshot:
    room_id: UUID
    room_code: str
    room_version: int
    host_member_id: UUID
    self_member_id: UUID
    members: tuple[MemberSnapshot, ...]
    game: BriefingSnapshot | None

    @property
    def phase(self) -> str:
        return "briefing" if self.game is not None else "lobby"


def active(seat: Seat, now: float) -> bool:
    return 0 <= now - seat.last_seen < PRESENCE_WINDOW_SECONDS


@dataclass
class Room:
    room_id: UUID
    code: str
    host_member_id: UUID
    members: dict[str, Seat]
    phase: Lobby | Briefing = field(default_factory=Lobby)
    version: int = 1
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def member(self, session: str) -> Seat:
        if session not in self.members:
            raise RoomError(403, "not_a_member", "Join this room before reading it")
        return self.members[session]

    def touch(self, session: str, now: float) -> None:
        self.members[session] = replace(self.member(session), last_seen=now)

    def snapshot(self, session: str, now: float) -> RoomSnapshot:
        caller = self.member(session)
        game = None
        assignments = {}
        if isinstance(self.phase, Briefing):
            phase = self.phase
            scenario = phase.scenario
            assignments = {item.member_id: item for item in phase.assignments}
            game = BriefingSnapshot(
                phase.phase_id, phase.round_number, phase.started_at,
                ScenarioIdentity(scenario.scenario_id, scenario.version, scenario.title, scenario.content_sha256),
                phase.timing.profile_id, phase.timing.briefing_seconds, scenario.initial_node_id,
                scenario.initial_metrics, scenario.public_documents,
                tuple(item.member_id for item in phase.assignments if item.eligible_from_round <= phase.round_number),
            )
        members = []
        for seat in self.members.values():
            assignment = assignments.get(seat.member_id)
            members.append(MemberSnapshot(
                seat.member_id, seat.display_name, seat.member_id == self.host_member_id, active(seat, now),
                assignment.role_id if assignment else None,
                assignment.eligible_from_round if assignment else None,
                assignment is not None and game is not None and assignment.eligible_from_round <= game.round_number,
            ))
        return RoomSnapshot(self.room_id, self.code, self.version, self.host_member_id,
                            caller.member_id, tuple(members), game)


class Rooms:
    def __init__(self, catalog: ScenarioCatalog, clock: Callable[[], float] = time.monotonic):
        self.catalog = catalog
        self.clock = clock
        self.sessions: set[str] = set()
        self.rooms: dict[UUID, Room] = {}
        self.codes: dict[str, UUID] = {}
        self.receipts: dict[tuple[str, UUID], tuple[tuple, RoomSnapshot]] = {}
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

    def retry(self, session: str, command_id: UUID, intent: tuple) -> RoomSnapshot | None:
        receipt = self.receipts.get((session, command_id))
        if receipt is None:
            return None
        previous_intent, view = receipt
        if intent != previous_intent:
            raise RoomError(409, "command_conflict", "Use a new command_id for a different request")
        return view

    def require_room(self, room_id: UUID) -> Room:
        if room_id not in self.rooms:
            raise RoomError(404, "room_not_found", "Room was not found")
        return self.rooms[room_id]

    async def create(self, session: str, command_id: UUID, room_code: str, display_name: str) -> RoomSnapshot:
        intent = ("create", room_code, display_name)
        async with self.creation_lock:
            if previous := self.retry(session, command_id, intent):
                existing_room = self.require_room(previous.room_id)
                async with existing_room.lock:
                    existing_room.touch(session, self.clock())
                return previous
            if room_code in self.codes:
                raise RoomError(409, "room_code_taken", "Generate another room code")
            now = self.clock()
            host = Seat(uuid4(), display_name, now)
            room = Room(uuid4(), room_code, host.member_id, {session: host})
            view = room.snapshot(session, now)
            self.rooms[room.room_id] = room
            self.codes[room_code] = room.room_id
            self.receipts[(session, command_id)] = (intent, view)
            return view

    async def join(self, session: str, command_id: UUID, room_code: str,
                   display_name: str, role_id: str | None = None) -> RoomSnapshot:
        intent = ("join", room_code, display_name, role_id)
        room_id = self.codes.get(room_code)
        if room_id is None:
            self.retry(session, command_id, intent)
            raise RoomError(404, "room_not_found", "Room code was not found")
        room = self.rooms[room_id]
        async with room.lock:
            if previous := self.retry(session, command_id, intent):
                room.touch(session, self.clock())
                return previous
            existing = room.members.get(session)
            now = self.clock()
            phase = room.phase
            if existing is not None:
                if existing.display_name.casefold() != display_name.casefold():
                    raise RoomError(409, "already_joined", "This browser already has a seat; renaming is not supported")
                assigned = next((item for item in phase.assignments if item.member_id == existing.member_id), None) if isinstance(phase, Briefing) else None
                if assigned is not None and role_id is not None and role_id != assigned.role_id:
                    raise RoomError(409, "role_locked", "Rejoining cannot change an assigned role")
                if assigned is None and role_id is not None:
                    raise RoomError(422, "role_not_yet_allowed", "Submit lobby roles together on Start")
                room.members[session] = replace(existing, last_seen=now)
            else:
                if any(seat.display_name.casefold() == display_name.casefold() for seat in room.members.values()):
                    raise RoomError(409, "name_taken", "Choose another display name")
                if len(room.members) >= ROOM_CAPACITY:
                    raise RoomError(409, "room_full", f"This room already has {ROOM_CAPACITY} members")
                if isinstance(phase, Briefing):
                    if role_id is None or role_id not in {role.role_id for role in phase.scenario.roles}:
                        raise RoomError(422, "invalid_role", "Choose an available role when joining after Start")
                    if role_id == "ceo":
                        raise RoomError(422, "ceo_reserved", "The existing CEO keeps that role")
                elif role_id is not None:
                    raise RoomError(422, "role_not_yet_allowed", "Submit lobby roles together on Start")
                seat = Seat(uuid4(), display_name, now)
                if isinstance(phase, Briefing):
                    room.phase = replace(phase, assignments=phase.assignments + (
                        Assignment(seat.member_id, role_id, phase.round_number + 1),
                    ))
                room.members[session] = seat
                room.version += 1
            view = room.snapshot(session, now)
            self.receipts[(session, command_id)] = (intent, view)
            return view

    async def start(self, session: str, room_id: UUID, command_id: UUID, spec: StartSpec) -> RoomSnapshot:
        intent = ("start", room_id, spec.room_code, spec.scenario_id, spec.scenario_version,
                  spec.timing_profile, tuple(sorted(spec.players)))
        room = self.require_room(room_id)
        async with room.lock:
            caller = room.member(session)
            if caller.member_id != room.host_member_id:
                raise RoomError(403, "host_required", "Only the room host can start")
            if previous := self.retry(session, command_id, intent):
                room.touch(session, self.clock())
                return previous
            if not isinstance(room.phase, Lobby):
                raise RoomError(409, "already_started", "This room has already started")
            if spec.room_code != room.code:
                raise RoomError(409, "room_code_mismatch", "The room code does not match this room")
            scenario = self.catalog.get(spec.scenario_id, spec.scenario_version)
            if scenario is None:
                raise RoomError(404, "scenario_not_found", "Choose an admitted scenario version")
            timing = next((item for item in scenario.timings if item.profile_id == spec.timing_profile), None)
            if timing is None:
                raise RoomError(422, "invalid_timing_profile", "Choose an available timing profile")
            ids = [member_id for member_id, _ in spec.players]
            if len(ids) != len(set(ids)):
                raise RoomError(422, "duplicate_member", "Each member must appear exactly once")
            if set(ids) != {seat.member_id for seat in room.members.values()}:
                raise RoomError(409, "roster_changed", "Refresh the room and submit all registered members")
            now = self.clock()
            if sum(token == session or active(seat, now) for token, seat in room.members.items()) < MINIMUM_TO_START:
                raise RoomError(409, "not_enough_active_members", "At least 3 recently active members are required")
            allowed = {role.role_id for role in scenario.roles}
            if any(role_id not in allowed for _, role_id in spec.players):
                raise RoomError(422, "invalid_role", "Choose roles from the selected scenario")
            if sum(role_id == "ceo" for _, role_id in spec.players) != 1:
                raise RoomError(422, "one_ceo_required", "Assign exactly one CEO")
            # Build a complete immutable phase before publishing the single transition.
            roles = dict(spec.players)
            phase = Briefing(uuid4(), datetime.now(timezone.utc), scenario, timing, tuple(
                Assignment(seat.member_id, roles[seat.member_id], 1) for seat in room.members.values()
            ))
            candidate = replace(room, phase=phase, version=room.version + 1,
                                members={**room.members, session: replace(caller, last_seen=now)})
            view = candidate.snapshot(session, now)
            room.phase, room.version, room.members = candidate.phase, candidate.version, candidate.members
            self.receipts[(session, command_id)] = (intent, view)
            return view

    async def snapshot(self, session: str, room_id: UUID) -> RoomSnapshot:
        room = self.require_room(room_id)
        async with room.lock:
            room.member(session)
            now = self.clock()
            room.touch(session, now)
            return room.snapshot(session, now)
