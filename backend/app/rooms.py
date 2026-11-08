"""Single process room authority for identity, narrative state and evidence."""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
import secrets
import time
from uuid import UUID, uuid4

from .rules import valid_unicode, MINIMUM_TO_START, PRESENCE_WINDOW_SECONDS, ROOM_CAPACITY
from .scenarios import Facts, PublicDocument, ScenarioCatalog
from . import simulation as sim
from . import gameplay



# Timed phases the host may end early with the skip_phase command.
SKIPPABLE = (sim.BriefingPhase, sim.ReadingPhase, sim.SpeakingPhase, sim.DiscussionPhase,
             sim.VotingPhase, sim.TiePhase, sim.ResultPhase, sim.IndividualDecisionPhase,
             sim.PrivateSessionPhase)
def ceo_of(assignments) -> UUID | None:
    """The member currently holding the CEO role, if any."""
    return next((item.member_id for item in assignments if item.role_id == "ceo"), None)


# Written individual decisions stay private to their author until the game ends.
PRIVATE_CONTRIBUTION_PHASES = frozenset({"individual_decision"})
MAX_DECISION_CHARACTERS = 1200

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
    ballot_source: str = "ai"
    manual_turns: bool = False
    start_at: str = "beginning"
    # start_at "assessment": prerecorded Round 1 decisions by electorate seat (seat 1 first).
    prerecorded_decisions: tuple[str, ...] = ()


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
    kind: str = "prepared"
    member_id: UUID | None = None
    description: str | None = None
    rationale: str | None = None


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
    server_time: datetime
    phase_deadline: datetime | None
    session_deadline: datetime | None
    active_speaker_id: UUID | None
    speaker_order: tuple[UUID, ...]
    self_vote: str | None
    vote_count_items: tuple[tuple[str, int], ...] | None
    tied_option_ids: tuple[str, ...]
    allowed_actions: tuple[str, ...]
    turns: tuple[sim.TurnRecord, ...]
    ceo_changes: tuple[sim.CeoChange, ...]
    ended_at: datetime | None
    proposals: tuple[sim.Proposal, ...]
    resolution: sim.Resolution | None
    options_source: str | None = None
    ai_options_status: str = "disabled"
    ballot_source: str = "ai"
    discussion_mode: str = "open"
    decision_mode: str = "vote"
    # Only for decision_mode "individual", from the individual_decision phase on: everyone's submitted
    # status plus the caller's own text. Other members' texts are never projected.
    individual_decisions: dict | None = None
    ending_title: str | None = None
    private_rounds: bool = False
    # From the private_session phase on: every electorate member's stage, never their content or scores.
    private_progress: tuple[dict, ...] | None = None
    # Index of the active turn in speaker_order (members repeat when the profile has several speaking rounds).
    speaker_index: int | None = None
    manual_turns: bool = False
    speaker_clip: dict | None = None
    # Open floor rooms: nobody holds the floor and any member may take it.
    floor_open: bool = False
    # Open floor rooms: who spoke last; they wait until someone else has had the floor.
    last_speaker_id: UUID | None = None
    start_at: str = "beginning"

    @property
    def facts(self) -> dict:
        return dict(self.fact_items)

    @property
    def vote_counts(self) -> dict | None:
        return dict(self.vote_count_items) if self.vote_count_items is not None else None


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
class LeaveReceipt:
    room_id: UUID
    room_version: int
    status: str


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
    turns: tuple[sim.TurnRecord, ...]
    ceo_changes: tuple[sim.CeoChange, ...]
    unresolved_action: sim.Resolution | None


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
    closed: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def ensure_open(self) -> None:
        if self.closed:
            raise RoomError(410, "room_closed", "The host has closed this lobby. Create or join another room.")

    def member(self, session: str) -> Seat:
        self.ensure_open()
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
        if isinstance(state.phase, sim.EndedPhase) and state.phase.ending_label in {"host_ended", "total_timeout"}:
            return None
        if isinstance(state.phase, sim.ResultPhase) and now >= state.phase.not_before:
            return None
        record = state.history[-1]
        return NarrationCaption(record.decision_id, state.phase.phase_id, record.text)

    def visible_contributions(self, member_id: UUID) -> tuple[Contribution, ...]:
        """Other members' written individual decisions are hidden until the game ends."""
        if isinstance(self.phase, StartedGame) and isinstance(self.phase.state.phase, sim.EndedPhase):
            return self.contributions
        return tuple(item for item in self.contributions
                     if not (item.kind == "answer" and item.phase in PRIVATE_CONTRIBUTION_PHASES)
                     or item.member_id == member_id)

    def individual_view(self, state: sim.Game, assignments: dict, electorate: tuple[UUID, ...],
                        caller_id: UUID) -> dict | None:
        if gameplay.decision_mode(state) != "individual" or not isinstance(
                state.phase, (sim.IndividualDecisionPhase, sim.PrivateSessionPhase, sim.EndedPhase)):
            return None
        names = {seat.member_id: seat.display_name for seat in self.members.values()}
        roles = {role.role_id: role.name for role in state.scenario.roles}
        decisions = {item.member_id: item for item in state.individual_decisions if item.round_id == state.round_id}
        own = decisions.get(caller_id)
        return {
            "submitted": [{"member_id": member, "display_name": names.get(member, ""),
                           "role_name": roles.get(assignments[member].role_id, assignments[member].role_id),
                           "submitted": member in decisions} for member in electorate],
            "self": {"text": own.text, "at": own.at} if own is not None else None,
        }

    def private_progress(self, state: sim.Game, assignments: dict) -> tuple[dict, ...] | None:
        if not state.private_stages:
            return None
        names = {seat.member_id: seat.display_name for seat in self.members.values()}
        roles = {role.role_id: role.name for role in state.scenario.roles}
        return tuple({"member_id": member, "display_name": names.get(member, ""),
                      "role_name": roles.get(assignments[member].role_id, assignments[member].role_id),
                      "stage": stage} for member, stage in state.private_stages)

    def snapshot(self, session: str, now: float) -> RoomSnapshot:
        caller = self.member(session)
        game, assignments, electorate = None, {}, ()
        if isinstance(self.phase, StartedGame):
            phase = self.phase
            state = phase.state
            assignments = {item.member_id: item for item in phase.assignments}
            electorate = phase.electorate
            current = None
            if isinstance(state.phase, (sim.DecisionPhase, sim.ReadingPhase, sim.SpeakingPhase,
                                        sim.DiscussionPhase, sim.VotingPhase, sim.TiePhase,
                                        sim.ResolvingPhase, sim.ResolutionFailedPhase,
                                        sim.IndividualDecisionPhase, sim.PrivateSessionPhase)):
                node = sim.current_node(state)
                current = CurrentNode(node.node_id, node.title, sim.render(node.inject, state.facts),
                                      node.study_questions, tuple(VisibleOption(option.option_id, option.label, option.kind, option.member_id,
                                                                           option.description, option.rationale)
                                                             for option in gameplay.options(state)))
            actions = []
            open_meeting = state.manual_turns and isinstance(state.phase, sim.SpeakingPhase)
            is_ceo = caller.member_id in assignments and assignments[caller.member_id].role_id == "ceo"
            if not isinstance(state.phase, sim.EndedPhase):
                # Open floor rooms: only the CEO ends the meeting.
                if (is_ceo if state.manual_turns else caller.member_id == self.host_member_id):
                    actions.append("end")
                if isinstance(state.phase, sim.BriefingPhase) and caller.member_id == self.host_member_id:
                    actions.append("finish_briefing")
                # Open floor rooms have no skipping during the meeting.
                if caller.member_id == self.host_member_id and isinstance(state.phase, SKIPPABLE) and not open_meeting:
                    actions.append("skip_phase")
                if isinstance(state.phase, sim.SpeakingPhase):
                    if caller.member_id == gameplay.speaker_of(state.phase):
                        actions.append("finish_speaking")
                    if open_meeting:
                        if gameplay.may_take_floor(state.phase, caller.member_id) and caller.member_id in electorate:
                            actions.append("take_floor")
                        if is_ceo:
                            actions.append("end_meeting")
                    elif caller.member_id == self.host_member_id:
                        actions.append("skip_speaker")
                if isinstance(state.phase, sim.VotingPhase) and caller.member_id in electorate:
                    actions.append("vote")
                if isinstance(state.phase, sim.IndividualDecisionPhase) and caller.member_id in electorate:
                    actions.append("submit_decision")
                if (isinstance(state.phase, sim.PrivateSessionPhase)
                        and caller.member_id in dict(state.private_stages)):
                    actions.append("private_session")
                # Custom ballot options only exist when the round ends in a vote.
                if (isinstance(state.phase, (sim.SpeakingPhase, sim.DiscussionPhase, sim.VotingPhase))
                        and caller.member_id in electorate and gameplay.decision_mode(state) == "vote"):
                    actions.append("proposal")
                if isinstance(state.phase, sim.ResolutionFailedPhase) and state.resolution.attempt < 2 and caller.member_id == self.host_member_id:
                    actions.append("retry_resolution")
                if isinstance(state.phase, sim.TiePhase):
                    if assignments[caller.member_id].role_id == "ceo":
                        actions.append("tie_decision")
                    ceo = next(item.member_id for item in phase.assignments if item.role_id == "ceo")
                    ceo_seat = next(item for item in self.members.values() if item.member_id == ceo)
                    if caller.member_id == self.host_member_id and not active(ceo_seat, now):
                        actions.append("reassign_ceo")
            due = gameplay.deadline(state)
            game = GameSnapshot(
                state.phase.kind, state.phase.phase_id, state.round_id, state.round_number, state.started_at,
                identity(state), state.timing.profile_id, state.timing.briefing_seconds, state.timing.result_seconds,
                state.scenario.initial_node_id, state.facts, state.scenario.public_documents, electorate, current,
                state.history, state.history[-1] if state.history else None,
                state.phase.ending_label if isinstance(state.phase, sim.EndedPhase) else None, self.narration(now),
                gameplay.at(state, now), gameplay.at(state, due) if due is not None else None,
                gameplay.at(state, state.session_deadline) if state.session_deadline is not None else None,
                gameplay.speaker_of(state.phase) if isinstance(state.phase, sim.SpeakingPhase) else None,
                state.phase.order if isinstance(state.phase, sim.SpeakingPhase) else (),
                dict(state.ballots).get(caller.member_id),
                None if isinstance(state.phase, sim.VotingPhase) else state.last_tally,
                state.phase.leaders if isinstance(state.phase, sim.TiePhase) else (), tuple(actions),
                state.turns, state.ceo_changes, state.ended_at, state.proposals, state.resolution,
                gameplay.options_source(state), gameplay.ai_options_status(state), state.ballot_source,
                gameplay.discussion_mode(state), gameplay.decision_mode(state),
                self.individual_view(state, assignments, electorate, caller.member_id),
                gameplay.ENDING_TITLES.get(state.phase.ending_label)
                if isinstance(state.phase, sim.EndedPhase) else None,
                state.timing.private_rounds, self.private_progress(state, assignments),
                state.phase.index if isinstance(state.phase, sim.SpeakingPhase) and not state.phase.floor_open else None,
                manual_turns=state.manual_turns, start_at=state.start_at,
                floor_open=isinstance(state.phase, sim.SpeakingPhase) and state.phase.floor_open,
                last_speaker_id=state.phase.last_speaker if open_meeting else None,
                speaker_clip={"clip_id": state.phase.clip[0], "started_at": gameplay.at(state, state.phase.clip[1]),
                              "text": state.phase.clip[2]}
                if isinstance(state.phase, sim.SpeakingPhase) and state.phase.clip is not None else None,
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
    def __init__(self, catalog: ScenarioCatalog, clock: Callable[[], float] = time.monotonic,
                 *, automatic: bool = True):
        self.catalog, self.clock = catalog, clock
        self.automatic = automatic
        self.sessions: set[str] = set()
        self.rooms: dict[UUID, Room] = {}
        self.codes: dict[str, UUID] = {}
        self.receipts: dict[tuple[str, UUID], tuple[tuple, RoomSnapshot | Contribution | LeaveReceipt]] = {}
        self.internal_receipts: dict[tuple[UUID, UUID], tuple[tuple, sim.Game]] = {}
        self.creation_lock = asyncio.Lock()
        # Set by the AI options service when a configured model can draft ballot options.
        self.ai_options_enabled = False

    def reconcile(self, room: Room, now: float) -> None:
        if room.closed or not self.automatic or not isinstance(room.phase, StartedGame):
            return
        phase = room.phase
        seen = {seat.member_id: seat.last_seen for seat in room.members.values()}
        roster = tuple((item.member_id, item.eligible_from_round, seen[item.member_id])
                       for item in phase.assignments)
        evidence = tuple((item.contribution_id, item.round_id) for item in room.contributions)
        state = gameplay.reconcile(phase.state, now, roster, evidence, ceo_of(phase.assignments))
        if state is not phase.state:
            electorate = tuple(item.member_id for item in phase.assignments
                               if item.eligible_from_round <= state.round_number)
            room.phase = replace(phase, state=state, electorate=electorate)
            room.version += 1

    async def tick(self) -> None:
        for room in tuple(self.rooms.values()):
            async with room.lock:
                self.reconcile(room, self.clock())

    async def play(self, session: str, room_id: UUID, command_id: UUID, phase_id: UUID,
                   round_id: UUID | None, action: str, value: str | UUID | None = None) -> RoomSnapshot:
        room = self.require_room(room_id)
        intent = (action, room_id, phase_id, round_id, value)
        async with room.lock:
            caller = room.member(session)
            now = self.clock()
            self.reconcile(room, now)
            if previous := self.retry(session, command_id, intent):
                room.touch(session, now)
                return previous
            if not isinstance(room.phase, StartedGame):
                raise RoomError(409, "not_started", "Start this room first")
            group, state = room.phase, room.phase.state
            phase = state.phase
            if isinstance(phase, sim.EndedPhase):
                raise RoomError(409, "game_ended", "Gameplay is already complete")
            if (action == "take_floor" and isinstance(phase, sim.SpeakingPhase) and state.manual_turns
                    and not phase.floor_open):
                holder = next((seat.display_name for seat in room.members.values()
                               if seat.member_id == gameplay.speaker_of(phase)), "Someone")
                raise RoomError(409, "floor_taken", f"{holder} has the floor. Wait until they finish their turn.")
            if phase.phase_id != phase_id or (round_id is not None and round_id != state.round_id):
                raise RoomError(409, "stale_phase", "Refresh the room before submitting")
            if not self.automatic:
                raise RoomError(409, "internal_fixture", "This fixture does not run timed gameplay")
            assignments = group.assignments
            is_ceo = caller.member_id == ceo_of(assignments)
            open_meeting = state.manual_turns and isinstance(phase, sim.SpeakingPhase)
            if action == "end":
                if state.manual_turns and not is_ceo:
                    raise RoomError(403, "ceo_required", "Only the CEO can end the meeting")
                if not state.manual_turns and caller.member_id != room.host_member_id:
                    raise RoomError(403, "host_required", "Only the host can end the meeting")
                state = gameplay.end(state, now, "host_ended")
            elif action == "finish_briefing":
                # The host ends the opening once the spoken briefing has played for the room.
                if caller.member_id != room.host_member_id:
                    raise RoomError(403, "host_required", "Only the host can finish the briefing")
                if not isinstance(phase, sim.BriefingPhase):
                    raise RoomError(409, "not_briefing", "The briefing has already finished")
                # The spoken briefing already covered the situation, so speaking turns begin at once.
                seen = {seat.member_id: seat.last_seen for seat in room.members.values()}
                state = gameplay.begin_speaking(state, now, group.electorate, seen, ceo_of(assignments))
            elif action == "take_floor":
                if not open_meeting:
                    raise RoomError(409, "not_open_floor", "Turns in this room follow the speaking order")
                if caller.member_id not in group.electorate:
                    raise RoomError(403, "not_eligible", "Only board members in this round can take the floor")
                if caller.member_id == phase.last_speaker:
                    raise RoomError(409, "spoke_last", "You just had the floor. Someone else speaks next.")
                state = gameplay.take_floor(state, now, caller.member_id)
            elif action == "end_meeting":
                if not open_meeting:
                    raise RoomError(409, "not_open_floor", "There is no open meeting to end")
                if not is_ceo:
                    raise RoomError(403, "ceo_required", "Only the CEO can end the meeting")
                seen = {seat.member_id: seat.last_seen for seat in room.members.values()}
                state = gameplay.end_meeting(state, now, seen, caller.member_id)
            elif action == "skip_phase":
                if caller.member_id != room.host_member_id:
                    raise RoomError(403, "host_required", "Only the host can skip a phase")
                if open_meeting:
                    raise RoomError(409, "not_skippable", "Only the CEO can end the meeting")
                if isinstance(phase, sim.SpeakingPhase):
                    state = gameplay.finish_record(state, now, "host_skip_phase", caller.member_id)
                    state = replace(state, phase=sim.DiscussionPhase(uuid4(), now))
                elif isinstance(phase, sim.BriefingPhase):
                    seen = {seat.member_id: seat.last_seen for seat in room.members.values()}
                    state = gameplay.begin_speaking(state, now, group.electorate, seen, ceo_of(assignments))
                elif isinstance(phase, sim.ResultPhase):
                    state = replace(state, phase=replace(phase, not_before=now))
                elif isinstance(phase, SKIPPABLE):
                    state = replace(state, phase=replace(phase, deadline=now))
                else:
                    raise RoomError(409, "not_skippable", "This phase cannot be skipped")
            elif action == "speaker_clip":
                # The speaker started (or stopped) a saved clip; the other windows play it from the same moment.
                if not isinstance(phase, sim.SpeakingPhase):
                    raise RoomError(409, "not_speaking", "There is no active speaker")
                if caller.member_id != gameplay.speaker_of(phase):
                    raise RoomError(403, "speaker_required", "Only the active speaker can share a clip")
                state = replace(state, phase=replace(phase, clip=(value[0], now, value[1]) if value else None))
            elif action in {"finish", "skip"}:
                if not isinstance(phase, sim.SpeakingPhase):
                    raise RoomError(409, "not_speaking", "There is no active speaker")
                speaker = gameplay.speaker_of(phase)
                if action == "finish" and caller.member_id != speaker:
                    raise RoomError(403, "speaker_required", "Only the active speaker can finish")
                if action == "skip" and state.manual_turns:
                    raise RoomError(409, "not_skippable", "Turns cannot be skipped in an open floor meeting")
                if action == "skip" and caller.member_id != room.host_member_id:
                    raise RoomError(403, "host_required", "Only the host can skip a speaker")
                seen = {seat.member_id: seat.last_seen for seat in room.members.values()}
                if state.manual_turns:
                    # Open floor: giving up the floor lets anyone take it next.
                    state = gameplay.open_floor(state, now, "finished", caller.member_id)
                else:
                    state = gameplay.next_speaker(state, now, seen,
                                                  f"host_skip: {value}" if action == "skip" else "finished",
                                                  caller.member_id)
            elif action == "vote":
                if not isinstance(phase, sim.VotingPhase):
                    raise RoomError(409, "not_voting", "Voting is not open")
                if caller.member_id not in group.electorate:
                    raise RoomError(403, "not_eligible", "Participation begins next round")
                if value not in {option.option_id for option in gameplay.options(state)}:
                    raise RoomError(422, "invalid_option", "Choose a frozen current option")
                ballots = dict(state.ballots)
                ballots[caller.member_id] = value
                state = replace(state, ballots=tuple(ballots.items()))
            elif action == "submit_decision":
                if not isinstance(phase, sim.IndividualDecisionPhase):
                    raise RoomError(409, "not_individual_decision", "Individual decisions are not open")
                if caller.member_id not in group.electorate:
                    raise RoomError(403, "not_eligible", "Participation begins next round")
                if (not isinstance(value, str) or not valid_unicode(value) or not value.strip()
                        or len(value) > MAX_DECISION_CHARACTERS):
                    raise RoomError(422, "invalid_decision", f"Write your decision in 1 to {MAX_DECISION_CHARACTERS} characters")
                # Every submission, including a replacement, stays attributed evidence.
                contribution = Contribution(uuid4(), len(room.contributions) + 1, caller.member_id,
                    next(item.role_id for item in assignments if item.member_id == caller.member_id),
                    phase.phase_id, phase.kind, state.round_id, state.round_number, state.node_id,
                    "answer", "typed", value, utc_now())
                room.contributions += (contribution,)
                decision = sim.IndividualDecision(caller.member_id, state.round_id, value,
                                                  gameplay.at(state, now), contribution.contribution_id)
                state = replace(state, individual_decisions=tuple(
                    item for item in state.individual_decisions
                    if (item.member_id, item.round_id) != (caller.member_id, state.round_id)) + (decision,))
                submitted = {item.member_id for item in state.individual_decisions if item.round_id == state.round_id}
                if set(group.electorate) <= submitted:
                    state = gameplay.finish_individual_decision(state, now, group.electorate)
            elif action == "proposal":
                if gameplay.decision_mode(state) != "vote":
                    raise RoomError(409, "proposals_disabled", "This room records individual decisions instead of a vote")
                if not isinstance(phase, (sim.SpeakingPhase, sim.DiscussionPhase, sim.VotingPhase)):
                    raise RoomError(409, "proposals_frozen", "Custom actions are editable only during speaking, discussion and voting")
                if caller.member_id not in group.electorate:
                    raise RoomError(403, "not_eligible", "Participation begins next round")
                if not isinstance(value, str) or not valid_unicode(value):
                    raise RoomError(422, "invalid_proposal", "Submit custom action text")
                previous = next((item for item in state.proposals if item.member_id == caller.member_id), None)
                voting = isinstance(phase, sim.VotingPhase)
                if voting and previous is not None and any(choice == previous.option_id for _, choice in state.ballots):
                    # Ballots already cast stay valid, so a voted custom option can no longer change or be withdrawn.
                    raise RoomError(409, "proposal_has_votes", "This custom option already has votes and can no longer be edited or withdrawn")
                proposals = tuple(item for item in state.proposals if item.member_id != caller.member_id)
                if value.strip():
                    contribution = Contribution(uuid4(), len(room.contributions) + 1, caller.member_id,
                        next(item.role_id for item in assignments if item.member_id == caller.member_id),
                        phase.phase_id, phase.kind, state.round_id, state.round_number, state.node_id,
                        "answer", "typed", value, utc_now())
                    room.contributions += (contribution,)
                    option_id = previous.option_id if previous else "custom_" + uuid4().hex
                    proposals += (sim.Proposal(option_id, caller.member_id, value, contribution.contribution_id),)
                state = replace(state, proposals=proposals)
                if voting:
                    # During voting the ballot is already frozen: add, edit in place or withdraw this member's option.
                    custom = (sim.BallotOption(option_id, value, "custom", caller.member_id),) if value.strip() else ()
                    frozen = state.frozen_options
                    if previous is not None and any(item.option_id == previous.option_id for item in frozen):
                        position = next(index for index, item in enumerate(frozen) if item.option_id == previous.option_id)
                        frozen = frozen[:position] + custom + frozen[position + 1:]
                    else:
                        frozen += custom
                    state = replace(state, frozen_options=frozen)
            elif action == "retry_resolution":
                if caller.member_id != room.host_member_id:
                    raise RoomError(403, "host_required", "Only the host can retry AI resolution")
                if not isinstance(phase, sim.ResolutionFailedPhase) or state.resolution.attempt >= 2:
                    raise RoomError(409, "retry_not_allowed", "One explicit retry is available after failure")
                job = uuid4()
                resolution = replace(state.resolution, job_id=job, attempt=state.resolution.attempt + 1,
                                     status="pending", error=None, processed_fragments=0, total_fragments=0)
                state = replace(state, phase=sim.ResolvingPhase(uuid4(), now + 15, job, resolution.attempt), resolution=resolution)
            elif action == "tie_decision":
                if not isinstance(phase, sim.TiePhase):
                    raise RoomError(409, "not_tied", "There is no pending CEO decision")
                ceo = next(item.member_id for item in assignments if item.role_id == "ceo")
                if caller.member_id != ceo:
                    raise RoomError(403, "ceo_required", "Only the current CEO can decide a tie")
                if value not in phase.leaders:
                    raise RoomError(422, "not_a_leader", "Choose one of the tied leaders")
                evidence = tuple(item.contribution_id for item in room.contributions if item.round_id == state.round_id)
                state = gameplay.resolve(state, now, value, evidence, "ceo")
            elif action == "reassign_ceo":
                if not isinstance(phase, sim.TiePhase):
                    raise RoomError(409, "not_tied", "CEO reassignment is limited to an active tie")
                if caller.member_id != room.host_member_id:
                    raise RoomError(403, "host_required", "Only the host can reassign the CEO")
                previous = next(item for item in assignments if item.role_id == "ceo")
                old_seat = next(seat for seat in room.members.values() if seat.member_id == previous.member_id)
                if previous.member_id == caller.member_id or active(old_seat, now):
                    raise RoomError(409, "ceo_connected", "The current CEO is still connected")
                target = next((item for item in assignments if item.member_id == value), None)
                target_seat = next((seat for seat in room.members.values() if seat.member_id == value), None)
                if target is None or value not in group.electorate or not (
                    value == caller.member_id or target_seat is not None and active(target_seat, now)
                ):
                    raise RoomError(422, "invalid_ceo", "Choose a connected eligible member")
                assignments = tuple(replace(item, role_id="ceo" if item.member_id == value else target.role_id)
                                    if item.member_id in (value, previous.member_id) else item for item in assignments)
                change = sim.CeoChange(state.round_id, previous.member_id, value, caller.member_id, gameplay.at(state, now))
                state = replace(state, ceo_changes=state.ceo_changes + (change,))
            else:
                raise RoomError(422, "invalid_action", "Unknown gameplay command")
            room.phase = replace(group, state=state, assignments=assignments)
            room.version += 1
            room.touch(session, now)
            if action in {"skip_phase", "finish", "skip", "take_floor", "end_meeting"}:
                # Apply the transition this command made due right away instead of on the next poll.
                self.reconcile(room, now)
            view = room.snapshot(session, now)
            self.receipts[(session, command_id)] = (intent, view)
            return view

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
        room = self.rooms[room_id]
        room.ensure_open()
        return room

    async def leave(self, session: str, room_id: UUID, command_id: UUID) -> LeaveReceipt:
        intent = ("leave", room_id)
        # The acknowledgement remains retrievable after membership or the room closes.
        if previous := self.retry(session, command_id, intent):
            return previous
        room = self.require_room(room_id)
        async with room.lock:
            if previous := self.retry(session, command_id, intent):
                return previous
            caller = room.member(session)
            if not isinstance(room.phase, Lobby):
                raise RoomError(409, "already_started", "Leaving a lobby is only available before the game starts")
            room.closed = caller.member_id == room.host_member_id
            del room.members[session]
            room.version += 1
            receipt = LeaveReceipt(room.room_id, room.version, "closed" if room.closed else "left")
            self.receipts[(session, command_id)] = (intent, receipt)
            return receipt

    async def create(self, session: str, command_id: UUID, room_code: str, display_name: str) -> RoomSnapshot:
        intent = ("create", room_code, display_name)
        async with self.creation_lock:
            if previous := self.retry(session, command_id, intent):
                room = self.require_room(previous.room_id)
                async with room.lock:
                    self.reconcile(room, self.clock())
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
            room.ensure_open()
            self.reconcile(room, self.clock())
            if previous := self.retry(session, command_id, intent):
                if room.member(session).member_id != previous.self_member_id:
                    raise RoomError(409, "membership_changed", "This join request belongs to a seat you left. Use a new command_id.")
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
                  spec.timing_profile, tuple(sorted(spec.players)), spec.ballot_source, spec.start_at)
        room = self.require_room(room_id)
        async with room.lock:
            caller = room.member(session)
            if caller.member_id != room.host_member_id:
                raise RoomError(403, "host_required", "Only the room host can start")
            self.reconcile(room, self.clock())
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
            if spec.start_at not in {"beginning", "assessment"}:
                raise RoomError(422, "invalid_start_at", "Start at the beginning or at the assessment")
            if spec.start_at == "assessment" and not timing.private_rounds:
                raise RoomError(422, "start_at_unavailable", "This timing profile has no private assessment round")
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
            if self.automatic:
                phase = replace(phase, state=replace(phase.state, session_deadline=now + timing.session_seconds,
                                                     ai_options_enabled=self.ai_options_enabled))
            if spec.ballot_source not in {"ai", "authored"}:
                raise RoomError(422, "invalid_ballot_source", "Choose ai or authored ballot options")
            phase = replace(phase, state=replace(phase.state, ballot_source=spec.ballot_source))
            if spec.manual_turns:
                # No automatic timing: turns wait for the speaker and the session has no overall ceiling.
                phase = replace(phase, state=replace(phase.state, manual_turns=True, session_deadline=None))
            added = ()
            if spec.start_at == "assessment":
                phase, added = self.assessment_start(room, phase, roles, spec.prerecorded_decisions, now)
            candidate = replace(room, phase=phase, version=room.version + 1, contributions=room.contributions + added,
                                members={**room.members, session: replace(caller, last_seen=now)})
            view = candidate.snapshot(session, now)
            room.phase, room.version, room.members = candidate.phase, candidate.version, candidate.members
            room.contributions = candidate.contributions
            self.receipts[(session, command_id)] = (intent, view)
            return view

    @staticmethod
    def assessment_start(room, phase: StartedGame, roles: dict, decisions: tuple[str, ...],
                         now: float) -> tuple[StartedGame, tuple]:
        """Test shortcut: record each seat's prerecorded Round 1 decision as if submitted, then open the private
        session with every member at the assessment stage. Seats without a prerecorded decision keep none."""
        state = phase.state
        decision_phase = uuid4()
        added, records = [], []
        for index, member in enumerate(phase.electorate):
            text = decisions[index] if index < len(decisions) else None
            if not text:
                continue
            contribution = Contribution(uuid4(), len(room.contributions) + len(added) + 1, member, roles[member],
                                        decision_phase, "individual_decision", state.round_id, state.round_number,
                                        state.node_id, "answer", "speech", text, utc_now())
            added.append(contribution)
            records.append(sim.IndividualDecision(member, state.round_id, text, gameplay.at(state, now),
                                                  contribution.contribution_id))
        state = gameplay.begin_assessment_start(replace(state, individual_decisions=tuple(records)), now, phase.electorate)
        return replace(phase, state=state), tuple(added)

    async def snapshot(self, session: str, room_id: UUID) -> RoomSnapshot:
        room = self.require_room(room_id)
        async with room.lock:
            room.member(session)
            now = self.clock()
            self.reconcile(room, now)
            room.touch(session, now)
            return room.snapshot(session, now)

    async def private_stage(self, room_id: UUID, member_id: UUID, stage: str) -> None:
        """Server integration only: PrivateSessions reports a member's forward stage change."""
        room = self.require_room(room_id)
        async with room.lock:
            now = self.clock()
            self.reconcile(room, now)
            if not isinstance(room.phase, StartedGame):
                return
            state = gameplay.record_private_stage(room.phase.state, now, member_id, stage)
            if state is not room.phase.state:
                room.phase = replace(room.phase, state=state)
                room.version += 1

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
            self.reconcile(room, self.clock())
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
            if not isinstance(text, str) or not valid_unicode(text) or not text.strip() or len(text) > 4000:
                raise RoomError(422, "invalid_contribution", "Submit 1 to 4000 characters of final text")
            if kind == "answer" and (state is None or not isinstance(state.phase, (sim.DecisionPhase, sim.SpeakingPhase, sim.DiscussionPhase)) or member.member_id not in game.electorate):
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
            member = room.member(session)
            self.reconcile(room, self.clock())
            return room.visible_contributions(member.member_id)

    async def evaluation_evidence(self, session: str, room_id: UUID) -> EvaluationEvidence:
        room = self.require_room(room_id)
        async with room.lock:
            room.member(session)
            self.reconcile(room, self.clock())
            if not isinstance(room.phase, StartedGame) or not isinstance(room.phase.state.phase, sim.EndedPhase):
                raise RoomError(409, "evidence_not_final", "Final evaluation evidence is available after ending")
            game, state = room.phase, room.phase.state
            roles = {item.member_id: item for item in game.assignments}
            members = tuple(EvidenceMember(seat.member_id, seat.display_name, roles[seat.member_id].role_id,
                                           roles[seat.member_id].eligible_from_round, seat.joined_at)
                            for seat in room.members.values())
            return EvaluationEvidence(room.room_id, identity(state), state.started_at, state.ended_at,
                                      state.phase.ending_label, members, state.scenario.public_documents,
                                      state.history, room.contributions, state.turns, state.ceo_changes,
                                      state.resolution if state.resolution is not None and state.resolution.status != "ready" else None)

    async def narration(self, session: str, room_id: UUID, narration_id: UUID) -> NarrationGrant:
        room = self.require_room(room_id)
        async with room.lock:
            member = room.member(session)
            self.reconcile(room, self.clock())
            caption = room.narration(self.clock())
            if caption is None or caption.narration_id != narration_id:
                raise RoomError(410, "narration_expired", "This narration is not current")
            return NarrationGrant(caption.narration_id, caption.phase_id, caption.text, member.member_id)
