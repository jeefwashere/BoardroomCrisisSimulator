"""Single process room authority for identity, narrative state and evidence."""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
import secrets
import time
from uuid import UUID, uuid4

from .rules import MINIMUM_TO_START, PRESENCE_WINDOW_SECONDS, ROOM_CAPACITY
from .scenarios import Facts, PublicDocument, ScenarioCatalog
from . import simulation as sim


class RoomError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Seat:
    member_id: UUID
    display_name: str
    last_seen: float
    joined_at: datetime


@dataclass(frozen=True)
class Assignment:
    member_id: UUID
    role_id: str
    eligible_from_round: int


@dataclass(frozen=True)
class Lobby:
    pass


@dataclass(frozen=True)
class StartedGame:
    state: sim.Game
    assignments: tuple[Assignment, ...]
    electorate: tuple[UUID, ...]


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
class VisibleOption:
    option_id: str
    label: str


@dataclass(frozen=True)
class CurrentNode:
    node_id: str
    title: str
    situation: str
    study_questions: tuple[str, ...]
    options: tuple[VisibleOption, ...]


@dataclass(frozen=True)
class NarrationCaption:
    narration_id: UUID
    phase_id: UUID
    text: str


@dataclass(frozen=True)
class NarrationGrant(NarrationCaption):
    member_id: UUID


@dataclass(frozen=True)
class GameSnapshot:
    phase: str
    phase_id: UUID
    round_id: UUID
    round_number: int
    started_at: datetime
    scenario: ScenarioIdentity
    timing_profile: str
    briefing_seconds: int
    result_seconds: int
    initial_node_id: str
    fact_items: Facts
    public_documents: tuple[PublicDocument, ...]
    eligible_member_ids: tuple[UUID, ...]
    current_node: CurrentNode | None
    history: tuple[sim.DecisionRecord, ...]
    last_result: sim.DecisionRecord | None
    ending_label: str | None
    narration: NarrationCaption | None

    @property
    def facts(self) -> dict:
        return dict(self.fact_items)


@dataclass(frozen=True)
class RoomSnapshot:
    room_id: UUID
    room_code: str
    room_version: int
    host_member_id: UUID
    self_member_id: UUID
    members: tuple[MemberSnapshot, ...]
    game: GameSnapshot | None

    @property
    def phase(self) -> str:
        return self.game.phase if self.game is not None else "lobby"


@dataclass(frozen=True)
class Contribution:
    contribution_id: UUID
    sequence: int
    member_id: UUID
    role_id: str | None
    phase_id: UUID | None
    phase: str
    round_id: UUID | None
    round_number: int | None
    node_id: str | None
    kind: str
    source: str
    text: str
    at: datetime


@dataclass(frozen=True)
class EvidenceMember:
    member_id: UUID
    display_name: str
    role_id: str
    eligible_from_round: int
    joined_at: datetime


@dataclass(frozen=True)
class EvaluationEvidence:
    room_id: UUID
    scenario: ScenarioIdentity
    started_at: datetime
    ended_at: datetime
    ending_label: str
    members: tuple[EvidenceMember, ...]
    public_documents: tuple[PublicDocument, ...]
    decisions: tuple[sim.DecisionRecord, ...]
    contributions: tuple[Contribution, ...]


def active(seat: Seat, now: float) -> bool:
    return 0 <= now - seat.last_seen < PRESENCE_WINDOW_SECONDS


def identity(state: sim.Game) -> ScenarioIdentity:
    s = state.scenario
    return ScenarioIdentity(s.scenario_id, s.version, s.title, s.content_sha256)


@dataclass
class Room:
    room_id: UUID
    code: str
    host_member_id: UUID
    members: dict[str, Seat]
    phase: Lobby | StartedGame = field(default_factory=Lobby)
    contributions: tuple[Contribution, ...] = ()
    version: int = 1
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def member(self, session: str) -> Seat:
        if session not in self.members:
            raise RoomError(403, "not_a_member", "Join this room before reading it")
        return self.members[session]

    def touch(self, session: str, now: float) -> None:
        self.members[session] = replace(self.member(session), last_seen=now)

    def narration(self, now: float) -> NarrationCaption | None:
        if isinstance(self.phase, Lobby):
            return None
        state = self.phase.state
        if not state.history or not isinstance(state.phase, (sim.ResultPhase, sim.EndedPhase)):
            return None
        if isinstance(state.phase, sim.ResultPhase) and now >= state.phase.not_before:
            return None
        record = state.history[-1]
        return NarrationCaption(record.decision_id, state.phase.phase_id, record.text)

    def snapshot(self, session: str, now: float) -> RoomSnapshot:
        caller = self.member(session)
        game, assignments, electorate = None, {}, ()
        if isinstance(self.phase, StartedGame):
            phase = self.phase
            state = phase.state
            assignments = {item.member_id: item for item in phase.assignments}
            electorate = phase.electorate
            current = None
            if isinstance(state.phase, sim.DecisionPhase):
                node = sim.current_node(state)
                current = CurrentNode(node.node_id, node.title, sim.render(node.inject, state.facts),
                                      node.study_questions, tuple(VisibleOption(option.option_id, option.label) for option in node.options))
            game = GameSnapshot(
                state.phase.kind, state.phase.phase_id, state.round_id, state.round_number, state.started_at,
                identity(state), state.timing.profile_id, state.timing.briefing_seconds, state.timing.result_seconds,
                state.scenario.initial_node_id, state.facts, state.scenario.public_documents, electorate, current,
                state.history, state.history[-1] if state.history else None,
                state.phase.ending_label if isinstance(state.phase, sim.EndedPhase) else None, self.narration(now),
            )
        members = []
        for seat in self.members.values():
            assignment = assignments.get(seat.member_id)
            members.append(MemberSnapshot(
                seat.member_id, seat.display_name, seat.member_id == self.host_member_id, active(seat, now),
                assignment.role_id if assignment else None,
                assignment.eligible_from_round if assignment else None, seat.member_id in electorate,
            ))
        return RoomSnapshot(self.room_id, self.code, self.version, self.host_member_id,
                            caller.member_id, tuple(members), game)


class Rooms:
    def __init__(self, catalog: ScenarioCatalog, clock: Callable[[], float] = time.monotonic):
        self.catalog, self.clock = catalog, clock
        self.sessions: set[str] = set()
        self.rooms: dict[UUID, Room] = {}
        self.codes: dict[str, UUID] = {}
        self.receipts: dict[tuple[str, UUID], tuple[tuple, RoomSnapshot | Contribution]] = {}
        self.internal_receipts: dict[tuple[UUID, UUID], tuple[tuple, sim.Game]] = {}
        self.creation_lock = asyncio.Lock()

    def session(self, cookie: str | None) -> str:
        if cookie in self.sessions:
            return cookie
        token = secrets.token_urlsafe(32)
        self.sessions.add(token)
        return token

    def authenticate(self, cookie: str | None) -> str:
        if cookie not in self.sessions:
            raise RoomError(401, "session_required", "Initialize a browser or tab session first")
        return cookie

    def retry(self, session: str, command_id: UUID, intent: tuple):
        receipt = self.receipts.get((session, command_id))
        if receipt is None:
            return None
        previous_intent, value = receipt
        if intent != previous_intent:
            raise RoomError(409, "command_conflict", "Use a new command_id for a different request")
        return value

    def require_room(self, room_id: UUID) -> Room:
        if room_id not in self.rooms:
            raise RoomError(404, "room_not_found", "Room was not found")
        return self.rooms[room_id]

    async def create(self, session: str, command_id: UUID, room_code: str, display_name: str) -> RoomSnapshot:
        intent = ("create", room_code, display_name)
        async with self.creation_lock:
            if previous := self.retry(session, command_id, intent):
                room = self.require_room(previous.room_id)
                async with room.lock:
                    room.touch(session, self.clock())
                return previous
            if room_code in self.codes:
                raise RoomError(409, "room_code_taken", "Generate another room code")
            now = self.clock()
            host = Seat(uuid4(), display_name, now, utc_now())
            room = Room(uuid4(), room_code, host.member_id, {session: host})
            view = room.snapshot(session, now)
            self.rooms[room.room_id], self.codes[room_code] = room, room.room_id
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
            existing, now, phase = room.members.get(session), self.clock(), room.phase
            if existing is not None:
                assigned = next((item for item in phase.assignments if item.member_id == existing.member_id), None) if isinstance(phase, StartedGame) else None
                if assigned is not None and role_id is not None and role_id != assigned.role_id:
                    raise RoomError(409, "role_locked", "Rejoining cannot change an assigned role")
                if assigned is None and role_id is not None:
                    raise RoomError(422, "role_not_yet_allowed", "Submit lobby roles together on Start")
                if existing.display_name != display_name:
                    if isinstance(phase, StartedGame) and isinstance(phase.state.phase, sim.EndedPhase):
                        raise RoomError(409, "game_ended", "Names are frozen after the game ends")
                    if any(seat.member_id != existing.member_id and seat.display_name.casefold() == display_name.casefold()
                           for seat in room.members.values()):
                        raise RoomError(409, "name_taken", "Choose another display name")
                    room.members[session] = replace(existing, display_name=display_name, last_seen=now)
                    room.version += 1
                else:
                    room.touch(session, now)
            else:
                if isinstance(phase, StartedGame) and isinstance(phase.state.phase, sim.EndedPhase):
                    raise RoomError(409, "game_ended", "New seats cannot join an ended game")
                if any(seat.display_name.casefold() == display_name.casefold() for seat in room.members.values()):
                    raise RoomError(409, "name_taken", "Choose another display name")
                if len(room.members) >= ROOM_CAPACITY:
                    raise RoomError(409, "room_full", f"This room already has {ROOM_CAPACITY} members")
                if isinstance(phase, StartedGame):
                    if role_id is None or role_id not in {role.role_id for role in phase.state.scenario.roles}:
                        raise RoomError(422, "invalid_role", "Choose an available role when joining after Start")
                    if role_id == "ceo":
                        raise RoomError(422, "ceo_reserved", "The existing CEO keeps that role")
                elif role_id is not None:
                    raise RoomError(422, "role_not_yet_allowed", "Submit lobby roles together on Start")
                seat = Seat(uuid4(), display_name, now, utc_now())
                if isinstance(phase, StartedGame):
                    room.phase = replace(phase, assignments=phase.assignments + (
                        Assignment(seat.member_id, role_id, phase.state.round_number + 1),
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
            roles = dict(spec.players)
            phase = StartedGame(sim.initialize(scenario, timing, now, utc_now(), uuid4(), uuid4()), tuple(
                Assignment(seat.member_id, roles[seat.member_id], 1) for seat in room.members.values()
            ), tuple(seat.member_id for seat in room.members.values()))
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

    async def transition_internal(self, room_id: UUID, event_id: UUID, expected_phase_id: UUID,
                                  event: sim.InternalEvent) -> sim.Game:
        """Server integration only. No HTTP route grants players this authority."""
        room = self.require_room(room_id)
        intent = (expected_phase_id, event)
        async with room.lock:
            receipt = self.internal_receipts.get((room_id, event_id))
            if receipt is not None:
                if receipt[0] != intent:
                    raise RoomError(409, "command_conflict", "Internal event ID was reused")
                return receipt[1]
            if not isinstance(room.phase, StartedGame):
                raise RoomError(409, "not_started", "Start this room first")
            phase = room.phase
            if expected_phase_id != phase.state.phase.phase_id:
                raise RoomError(409, "stale_phase", "The internal event refers to an older phase")
            evidence = tuple(item.contribution_id for item in room.contributions if item.round_id == phase.state.round_id)
            try:
                state = sim.transition(phase.state, event, self.clock(), utc_now(),
                                       sim.TransitionIds(uuid4(), uuid4(), uuid4()), evidence)
            except sim.TransitionError as error:
                raise RoomError(error.status, error.code, error.message) from error
            electorate = phase.electorate
            if state.round_number != phase.state.round_number:
                electorate = tuple(item.member_id for item in phase.assignments if item.eligible_from_round <= state.round_number)
            room.phase = replace(phase, state=state, electorate=electorate)
            room.version += 1
            self.internal_receipts[(room_id, event_id)] = (intent, state)
            return state

    async def contribute(self, session: str, room_id: UUID, command_id: UUID,
                         phase_id: UUID | None, kind: str, source: str, text: str) -> Contribution:
        room = self.require_room(room_id)
        intent = ("contribute", room_id, phase_id, kind, source, text)
        async with room.lock:
            member = room.member(session)
            if previous := self.retry(session, command_id, intent):
                room.touch(session, self.clock())
                return previous
            game = room.phase if isinstance(room.phase, StartedGame) else None
            state = game.state if game else None
            if state is not None and isinstance(state.phase, sim.EndedPhase):
                raise RoomError(409, "game_ended", "The evaluation evidence is frozen")
            current_phase_id = state.phase.phase_id if state else None
            if phase_id != current_phase_id:
                raise RoomError(409, "stale_phase", "Refresh the room before submitting")
            if kind not in {"answer", "chat"} or source not in {"typed", "speech"}:
                raise RoomError(422, "invalid_contribution", "Choose an allowed contribution kind and source")
            if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                raise RoomError(422, "invalid_contribution", "Submit 1 to 4000 characters of final text")
            if kind == "answer" and (state is None or not isinstance(state.phase, sim.DecisionPhase) or member.member_id not in game.electorate):
                raise RoomError(403, "answer_not_allowed", "Answers require current round eligibility")
            assigned = next((item for item in game.assignments if item.member_id == member.member_id), None) if game else None
            record = Contribution(uuid4(), len(room.contributions) + 1, member.member_id,
                                  assigned.role_id if assigned else None, current_phase_id,
                                  state.phase.kind if state else "lobby", state.round_id if state else None,
                                  state.round_number if state else None, state.node_id if state else None,
                                  kind, source, text, utc_now())
            room.contributions += (record,)
            room.version += 1
            room.touch(session, self.clock())
            self.receipts[(session, command_id)] = (intent, record)
            return record

    async def contributions(self, session: str, room_id: UUID) -> tuple[Contribution, ...]:
        room = self.require_room(room_id)
        async with room.lock:
            room.member(session)
            return room.contributions

    async def evaluation_evidence(self, session: str, room_id: UUID) -> EvaluationEvidence:
        room = self.require_room(room_id)
        async with room.lock:
            room.member(session)
            if not isinstance(room.phase, StartedGame) or not isinstance(room.phase.state.phase, sim.EndedPhase):
                raise RoomError(409, "evidence_not_final", "Final evaluation evidence is available after ending")
            game, state = room.phase, room.phase.state
            roles = {item.member_id: item for item in game.assignments}
            members = tuple(EvidenceMember(seat.member_id, seat.display_name, roles[seat.member_id].role_id,
                                           roles[seat.member_id].eligible_from_round, seat.joined_at)
                            for seat in room.members.values())
            return EvaluationEvidence(room.room_id, identity(state), state.started_at, state.history[-1].resolved_at,
                                      state.phase.ending_label, members, state.scenario.public_documents,
                                      state.history, room.contributions)

    async def narration(self, session: str, room_id: UUID, narration_id: UUID) -> NarrationGrant:
        room = self.require_room(room_id)
        async with room.lock:
            member = room.member(session)
            caption = room.narration(self.clock())
            if caption is None or caption.narration_id != narration_id:
                raise RoomError(410, "narration_expired", "This narration is not current")
            return NarrationGrant(caption.narration_id, caption.phase_id, caption.text, member.member_id)
