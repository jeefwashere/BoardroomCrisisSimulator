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
class DecisionRecord:
    decision_id: UUID
    round_id: UUID
    round_number: int
    node_id: str
    question: str
    selected_option_id: str | None
    selected_option_label: str | None
    resolution_kind: Literal["prepared", "no_decision"]
    outcome_id: str
    text: str
    facts_before: Facts
    facts_after: Facts
    contribution_ids: tuple[UUID, ...]
    resolved_at: datetime

    @property
    def facts_before_view(self) -> dict:
        return dict(self.facts_before)

    @property
    def facts_after_view(self) -> dict:
        return dict(self.facts_after)


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
    phase: BriefingPhase | DecisionPhase | ResultPhase | EndedPhase


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
class AdvanceResult:
    pass


InternalEvent = BeginDecision | ResolvePrepared | ResolveNoDecision | AdvanceResult


@dataclass(frozen=True)
class TransitionIds:
    phase_id: UUID
    round_id: UUID
    decision_id: UUID


def initialize(scenario: Scenario, timing: Timing, now: float, at: datetime,
               phase_id: UUID, round_id: UUID) -> Game:
    return Game(scenario, timing, at, round_id, 1, scenario.initial_node_id,
                tuple(sorted(scenario.initial_facts)), (), BriefingPhase(phase_id, now + timing.briefing_seconds))


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
    if not isinstance(phase, DecisionPhase) or not isinstance(event, (ResolvePrepared, ResolveNoDecision)):
        raise TransitionError("invalid_transition", "This internal event is not valid in the current phase")
    node = current_node(game)
    option = None
    if isinstance(event, ResolvePrepared):
        option = next((item for item in node.options if item.option_id == event.option_id), None)
        if option is None:
            raise TransitionError("option_not_found", "The selected option is not part of this node", 422)
        outcome_id = option.outcome_id
    else:
        outcome_id = node.no_decision_outcome_id
    outcome = next(item for item in node.outcomes if item.outcome_id == outcome_id)
    facts = dict(game.facts)
    facts.update(outcome.fact_updates)
    next_facts = tuple(sorted(facts.items()))
    record = DecisionRecord(
        ids.decision_id, game.round_id, game.round_number, game.node_id, render(node.inject, game.facts),
        option.option_id if option else None, option.label if option else None,
        "prepared" if option else "no_decision", outcome.outcome_id, outcome.summary,
        game.facts, next_facts, contribution_ids, at,
    )
    if outcome.terminal:
        next_phase = EndedPhase(ids.phase_id, outcome.ending_label)
    else:
        next_phase = ResultPhase(ids.phase_id, now + game.timing.result_seconds, outcome.next_node_id)
    return replace(game, facts=next_facts, history=game.history + (record,), phase=next_phase)
