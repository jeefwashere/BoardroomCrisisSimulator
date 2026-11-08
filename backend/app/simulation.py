"""Pure narrative transitions. Rooms alone publishes returned replacements."""

from dataclasses import dataclass, replace
from datetime import datetime
import re
from typing import Literal
from uuid import UUID

from .scenarios import Facts, Node, Scenario, Timing


class TransitionError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        self.code, self.message, self.status = code, message, status


@dataclass(frozen=True)
class BriefingPhase:
    phase_id: UUID
    not_before: float
    kind: Literal["briefing"] = "briefing"


@dataclass(frozen=True)
class DecisionPhase:
    phase_id: UUID
    kind: Literal["decision"] = "decision"


@dataclass(frozen=True)
class ResultPhase:
    phase_id: UUID
    not_before: float
    next_node_id: str
    kind: Literal["result"] = "result"


@dataclass(frozen=True)
class EndedPhase:
    phase_id: UUID
    ending_label: str
    kind: Literal["ended"] = "ended"


@dataclass(frozen=True)
class ReadingPhase:
    phase_id: UUID
    deadline: float
    kind: Literal["reading"] = "reading"


@dataclass(frozen=True)
class SpeakingPhase:
    phase_id: UUID
    deadline: float
    discussion_deadline: float
    order: tuple[UUID, ...]
    index: int
    slot_seconds: int
    started_at: float
    kind: Literal["speaking"] = "speaking"


@dataclass(frozen=True)
class DiscussionPhase:
    phase_id: UUID
    deadline: float
    kind: Literal["discussion"] = "discussion"


@dataclass(frozen=True)
class VotingPhase:
    phase_id: UUID
    deadline: float
    kind: Literal["voting"] = "voting"


@dataclass(frozen=True)
class IndividualDecisionPhase:
    """Each electorate member writes a private decision instead of voting (decision_mode "individual")."""
    phase_id: UUID
    deadline: float
    kind: Literal["individual_decision"] = "individual_decision"


@dataclass(frozen=True)
class PrivateSessionPhase:
    """Rounds 2 and 3: every electorate member works through a private coaching and assessment branch."""
    phase_id: UUID
    deadline: float
    kind: Literal["private_session"] = "private_session"


@dataclass(frozen=True)
class TiePhase:
    phase_id: UUID
    deadline: float
    leaders: tuple[str, ...]
    kind: Literal["tie_break"] = "tie_break"


@dataclass(frozen=True)
class ResolvingPhase:
    phase_id: UUID
    deadline: float
    job_id: UUID
    attempt: int
    kind: Literal["resolving"] = "resolving"


@dataclass(frozen=True)
class ResolutionFailedPhase:
    phase_id: UUID
    kind: Literal["resolution_failed"] = "resolution_failed"


@dataclass(frozen=True)
class Proposal:
    option_id: str
    member_id: UUID
    text: str
    contribution_id: UUID


@dataclass(frozen=True)
class BallotOption:
    option_id: str
    label: str
    kind: Literal["prepared", "custom", "ai"] = "prepared"
    member_id: UUID | None = None
    description: str | None = None
    rationale: str | None = None
    # Server validated authored consequence for "ai" options; never projected to players.
    outcome_id: str | None = None


@dataclass(frozen=True)
class AiOptionSet:
    """Agent drafted ballot options for one round. Results from other rounds or jobs are discarded."""
    round_id: UUID
    job_id: UUID                    # latest started job for this round
    stage: Literal["speaking", "discussion"]
    status: Literal["pending", "ready", "failed"]   # status of the latest job
    jobs: tuple[UUID, ...] = ()     # every job started for this round
    options: tuple[BallotOption, ...] = ()          # latest accepted ready set
    ready_job_id: UUID | None = None
    ready_stage: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class Resolution:
    job_id: UUID
    attempt: int
    option_id: str
    member_id: UUID
    text: str
    text_sha256: str
    selection_method: str
    status: str = "pending"
    error: str | None = None
    processed_fragments: int = 0
    total_fragments: int = 0


@dataclass(frozen=True)
class IndividualDecision:
    """One member's latest written decision for a round. The text is private to its author in snapshots."""
    member_id: UUID
    round_id: UUID
    text: str
    at: datetime
    contribution_id: UUID


@dataclass(frozen=True)
class TurnRecord:
    member_id: UUID
    round_id: UUID
    phase_id: UUID
    reason: str
    started_at: datetime
    ended_at: datetime
    actor_id: UUID | None = None


@dataclass(frozen=True)
class CeoChange:
    round_id: UUID
    previous_member_id: UUID
    member_id: UUID
    actor_id: UUID
    at: datetime


@dataclass(frozen=True)
class DecisionRecord:
    decision_id: UUID
    round_id: UUID
    round_number: int
    node_id: str
    question: str
    selected_option_id: str | None
    selected_option_label: str | None
    resolution_kind: Literal["prepared", "no_decision", "custom", "ai"]
    outcome_id: str
    text: str
    facts_before: Facts
    facts_after: Facts
    contribution_ids: tuple[UUID, ...]
    resolved_at: datetime
    vote_counts: tuple[tuple[str, int], ...] = ()
    selection_method: str = "internal"
    ai_job_id: UUID | None = None
    ai_attempt: int | None = None
    proposer_id: UUID | None = None

    @property
    def facts_before_view(self) -> dict:
        return dict(self.facts_before)

    @property
    def facts_after_view(self) -> dict:
        return dict(self.facts_after)

    @property
    def vote_counts_view(self) -> dict:
        return dict(self.vote_counts)


@dataclass(frozen=True)
class Game:
    scenario: Scenario
    timing: Timing
    started_at: datetime
    round_id: UUID
    round_number: int
    node_id: str
    facts: Facts
    history: tuple[DecisionRecord, ...]
    phase: BriefingPhase | DecisionPhase | ResultPhase | EndedPhase | ReadingPhase | SpeakingPhase | DiscussionPhase | VotingPhase | TiePhase | ResolvingPhase | ResolutionFailedPhase | IndividualDecisionPhase | PrivateSessionPhase
    started_mono: float = 0
    session_deadline: float | None = None
    ballots: tuple[tuple[UUID, str], ...] = ()
    last_tally: tuple[tuple[str, int], ...] = ()
    turns: tuple[TurnRecord, ...] = ()
    ceo_changes: tuple[CeoChange, ...] = ()
    ended_at: datetime | None = None
    proposals: tuple[Proposal, ...] = ()
    frozen_options: tuple[BallotOption, ...] = ()
    resolution: Resolution | None = None
    ai_options_enabled: bool = False
    ai_options: AiOptionSet | None = None
    options_source: Literal["ai", "prepared_fallback", "authored"] | None = None
    # Per room setting chosen at Start: agent drafted ballots or the authored prepared options.
    ballot_source: Literal["ai", "authored"] = "ai"
    # Written decisions for decision_mode "individual"; resubmission replaces the member's entry.
    individual_decisions: tuple[IndividualDecision, ...] = ()
    # Private session progress per electorate member, in electorate order, from the private_session phase on.
    # Stages: "not_started", "coaching", "card", "assessment", "complete". Contents live in PrivateSessions.
    private_stages: tuple[tuple[UUID, str], ...] = ()


@dataclass(frozen=True)
class BeginDecision:
    pass


@dataclass(frozen=True)
class ResolvePrepared:
    option_id: str


@dataclass(frozen=True)
class ResolveNoDecision:
    pass


@dataclass(frozen=True)
class ResolveCustom:
    option_id: str
    text: str
    outcome_id: str


@dataclass(frozen=True)
class AdvanceResult:
    pass


InternalEvent = BeginDecision | ResolvePrepared | ResolveNoDecision | ResolveCustom | AdvanceResult


@dataclass(frozen=True)
class TransitionIds:
    phase_id: UUID
    round_id: UUID
    decision_id: UUID


def initialize(scenario: Scenario, timing: Timing, now: float, at: datetime,
               phase_id: UUID, round_id: UUID) -> Game:
    return Game(scenario, timing, at, round_id, 1, scenario.initial_node_id,
                tuple(sorted(scenario.initial_facts)), (), BriefingPhase(phase_id, now + timing.briefing_seconds),
                started_mono=now)


def current_node(game: Game) -> Node:
    return next(node for node in game.scenario.nodes if node.node_id == game.node_id)


def render(template: str, facts: Facts) -> str:
    values = dict(facts)
    return re.sub(r"\{\{([^{}]+)\}\}", lambda match: "unknown" if values[match[1]] is None else str(values[match[1]]), template)


def transition(game: Game, event: InternalEvent, now: float, at: datetime,
               ids: TransitionIds, contribution_ids: tuple[UUID, ...] = ()) -> Game:
    phase = game.phase
    if isinstance(phase, EndedPhase):
        raise TransitionError("game_ended", "Gameplay is already complete")
    if isinstance(event, BeginDecision) and isinstance(phase, BriefingPhase):
        if now < phase.not_before:
            raise TransitionError("phase_not_elapsed", "The briefing period has not elapsed")
        return replace(game, phase=DecisionPhase(ids.phase_id))
    if isinstance(event, AdvanceResult) and isinstance(phase, ResultPhase):
        if now < phase.not_before:
            raise TransitionError("phase_not_elapsed", "The result presentation period has not elapsed")
        return replace(game, phase=DecisionPhase(ids.phase_id), node_id=phase.next_node_id,
                       round_number=game.round_number + 1, round_id=ids.round_id)
    if not isinstance(phase, DecisionPhase) or not isinstance(event, (ResolvePrepared, ResolveNoDecision, ResolveCustom)):
        raise TransitionError("invalid_transition", "This internal event is not valid in the current phase")
    node = current_node(game)
    option = None
    if isinstance(event, ResolvePrepared):
        option = next((item for item in node.options if item.option_id == event.option_id), None)
        if option is None:
            raise TransitionError("option_not_found", "The selected option is not part of this node", 422)
        outcome_id = option.outcome_id
    elif isinstance(event, ResolveCustom):
        if event.outcome_id not in node.allowed_custom_outcome_ids:
            raise TransitionError("invalid_custom_outcome", "AI must select an allowed authored outcome", 422)
        outcome_id = event.outcome_id
    else:
        outcome_id = node.no_decision_outcome_id
    outcome = next(item for item in node.outcomes if item.outcome_id == outcome_id)
    facts = dict(game.facts)
    facts.update(outcome.fact_updates)
    next_facts = tuple(sorted(facts.items()))
    record = DecisionRecord(
        ids.decision_id, game.round_id, game.round_number, game.node_id, render(node.inject, game.facts),
        event.option_id if isinstance(event, ResolveCustom) else option.option_id if option else None,
        event.text if isinstance(event, ResolveCustom) else option.label if option else None,
        "custom" if isinstance(event, ResolveCustom) else "prepared" if option else "no_decision", outcome.outcome_id, outcome.summary,
        game.facts, next_facts, contribution_ids, at,
    )
    if outcome.terminal:
        next_phase = EndedPhase(ids.phase_id, outcome.ending_label)
    else:
        next_phase = ResultPhase(ids.phase_id, now + game.timing.result_seconds, outcome.next_node_id)
    return replace(game, facts=next_facts, history=game.history + (record,), phase=next_phase,
                   ended_at=at if outcome.terminal else None)
