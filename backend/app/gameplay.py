"""Deterministic gameplay scheduling. Rooms publishes all results under its lock."""

from collections import Counter
from dataclasses import replace
from datetime import timedelta
import hashlib
from uuid import UUID, uuid4

from . import simulation as sim
from .rules import PRESENCE_WINDOW_SECONDS

EXPERT_PANEL_SECONDS = 90
# Ending label when the individual decision phase closes (decision_mode "individual").
INDIVIDUAL_ENDING = "individual_decisions_recorded"
INDIVIDUAL_ENDING_TITLE = "Individual decisions recorded"
# Ending label when the private_session phase (Rounds 2 and 3) closes.
PRIVATE_ENDING = "private_sessions_complete"
PRIVATE_ENDING_TITLE = "Private sessions complete"
PRIVATE_STAGES = ("not_started", "coaching", "card", "assessment", "complete")
ENDING_TITLES = {INDIVIDUAL_ENDING: INDIVIDUAL_ENDING_TITLE, PRIVATE_ENDING: PRIVATE_ENDING_TITLE}


def at(game: sim.Game, instant: float):
    return game.started_at + timedelta(seconds=instant - game.started_mono)


def deadline(game: sim.Game) -> float | None:
    phase = game.phase
    if isinstance(phase, (sim.BriefingPhase, sim.ResultPhase)):
        return phase.not_before
    return getattr(phase, "deadline", None)


def discussion_mode(game: sim.Game) -> str:
    return "experts" if game.timing.unused_speaking == "expert_panel" else "open"


def decision_mode(game: sim.Game) -> str:
    return "individual" if game.timing.decision_mode == "individual" else "vote"


def begin_individual_decision(game: sim.Game, instant: float) -> sim.Game:
    """Replaces the board vote: no ballot freezes and no outcome is resolved."""
    return replace(game, phase=sim.IndividualDecisionPhase(uuid4(), instant + game.timing.individual_decision_seconds))


def finish_individual_decision(game: sim.Game, instant: float, electorate: tuple[UUID, ...] = ()) -> sim.Game:
    """Called when every member has submitted, at the deadline, or on host skip.

    Timing profiles with private_rounds continue into the private_session phase; others end here.
    """
    if game.timing.private_rounds and electorate:
        return begin_private_session(game, instant, electorate)
    return end(game, instant, INDIVIDUAL_ENDING)


def begin_private_session(game: sim.Game, instant: float, electorate: tuple[UUID, ...]) -> sim.Game:
    """Rounds 2 and 3 run per member in PrivateSessions; the room only tracks stage and deadline."""
    ends = instant + game.timing.private_session_seconds
    session_deadline = game.session_deadline
    if session_deadline is not None:
        # The private rounds have their own budget; the Round 1 ceiling must not cut them short.
        session_deadline = max(session_deadline, ends)
    return replace(game, phase=sim.PrivateSessionPhase(uuid4(), ends), session_deadline=session_deadline,
                   private_stages=tuple((member, "not_started") for member in electorate))


def record_private_stage(game: sim.Game, instant: float, member_id: UUID, stage: str) -> sim.Game:
    """Stages only move forward. The phase finishes once every electorate member is complete."""
    if not isinstance(game.phase, sim.PrivateSessionPhase) or stage not in PRIVATE_STAGES:
        return game
    stages = dict(game.private_stages)
    if member_id not in stages or PRIVATE_STAGES.index(stage) <= PRIVATE_STAGES.index(stages[member_id]):
        return game
    stages[member_id] = stage
    game = replace(game, private_stages=tuple((member, stages[member]) for member, _ in game.private_stages))
    if all(value == "complete" for _, value in game.private_stages):
        return finish_private_session(game, instant)
    return game


def finish_private_session(game: sim.Game, instant: float) -> sim.Game:
    """Called when every member completes, at the deadline, or on host skip.

    Round 4 (board reunion) hooks in here: begin its phase instead of ending the game.
    """
    return end(game, instant, PRIVATE_ENDING)


def ready_ai_options(game: sim.Game) -> tuple[sim.BallotOption, ...]:
    ai = game.ai_options
    if game.ballot_source != "ai" or ai is None or ai.round_id != game.round_id:
        return ()
    return ai.options


def options(game: sim.Game) -> tuple[sim.BallotOption, ...]:
    """Frozen ballot, else the ballot that would freeze now.

    Ready agent drafted options replace the authored prepared options; human
    custom proposals are always appended.
    """
    if game.frozen_options:
        return game.frozen_options
    base = ready_ai_options(game) or tuple(
        sim.BallotOption(option.option_id, option.label, description=option.description)
        for option in sim.current_node(game).options)
    return base + tuple(sim.BallotOption(item.option_id, item.text, "custom", item.member_id) for item in game.proposals)


def options_source(game: sim.Game) -> str:
    if game.ballot_source == "authored":
        return "authored"
    if game.frozen_options and game.options_source is not None:
        return game.options_source
    return "ai" if ready_ai_options(game) else "prepared_fallback"


def ai_options_wanted(game: sim.Game) -> bool:
    """Agents draft only when configured, chosen for this room, and the node allows custom outcomes."""
    return (game.ai_options_enabled and game.ballot_source == "ai" and decision_mode(game) == "vote"
            and bool(sim.current_node(game).allowed_custom_outcome_ids))


def ai_options_status(game: sim.Game) -> str:
    if not ai_options_wanted(game):
        return "disabled"
    if game.frozen_options:
        return "ready" if options_source(game) == "ai" else "failed"
    ai = game.ai_options
    if ai is None or ai.round_id != game.round_id:
        return "pending"
    return "ready" if ai.options else ai.status


def freeze(game: sim.Game) -> sim.Game:
    frozen = options(game)
    source = ("authored" if game.ballot_source == "authored" else
              "ai" if any(option.kind == "ai" for option in frozen) else "prepared_fallback")
    return replace(game, frozen_options=frozen, options_source=source)


def end(game: sim.Game, instant: float, reason: str) -> sim.Game:
    if isinstance(game.phase, sim.EndedPhase):
        return game
    if isinstance(game.phase, sim.SpeakingPhase):
        game = finish_record(game, instant, reason)
    resolution = game.resolution
    if resolution is not None and resolution.status != "ready":
        resolution = replace(resolution, status="unresolved", error="Game ended before the selected custom action was resolved")
    return replace(game, phase=sim.EndedPhase(uuid4(), reason), ended_at=at(game, instant), resolution=resolution)


def finish_record(game: sim.Game, instant: float, reason: str, actor_id: UUID | None = None):
    phase = game.phase
    record = sim.TurnRecord(phase.order[phase.index], game.round_id, phase.phase_id,
                            reason, at(game, phase.started_at), at(game, instant), actor_id)
    return replace(game, turns=game.turns + (record,))


def select_speaker(game: sim.Game, instant: float, last_seen: dict[UUID, float],
                   order: tuple[UUID, ...], index: int, slot: int, discussion_deadline: float):
    while index < len(order):
        member = order[index]
        if 0 <= instant - last_seen[member] < PRESENCE_WINDOW_SECONDS:
            return replace(game, phase=sim.SpeakingPhase(
                uuid4(), min(instant + slot, discussion_deadline), discussion_deadline,
                order, index, slot, instant))
        skipped = sim.TurnRecord(member, game.round_id, uuid4(), "disconnected",
                                 at(game, instant), at(game, instant))
        game = replace(game, turns=game.turns + (skipped,))
        index += 1
    if game.timing.unused_speaking == "expert_panel":
        # The AI expert panel speaks for exactly 90 seconds, never beyond the session ceiling.
        ends = instant + EXPERT_PANEL_SECONDS
        if game.session_deadline is not None:
            ends = min(ends, game.session_deadline)
        return replace(game, phase=sim.DiscussionPhase(uuid4(), ends))
    if game.timing.unused_speaking == "skip_to_vote":
        # Voting opens as soon as the last turn ends; reconcile freezes the ballot immediately.
        return replace(game, phase=sim.DiscussionPhase(uuid4(), instant))
    return replace(game, phase=sim.DiscussionPhase(uuid4(), discussion_deadline))


def next_speaker(game: sim.Game, instant: float, last_seen: dict[UUID, float],
                 reason: str, actor_id: UUID | None = None) -> sim.Game:
    phase = game.phase
    game = finish_record(game, instant, reason, actor_id)
    return select_speaker(game, instant, last_seen, phase.order, phase.index + 1,
                          phase.slot_seconds, phase.discussion_deadline)


def begin_speaking(game: sim.Game, instant: float, electorate: tuple[UUID, ...],
                   last_seen: dict[UUID, float]) -> sim.Game:
    rounds = getattr(game.timing, "speaking_rounds", 1)
    if rounds > 1:
        # Several times round the table: each turn keeps the full speaker slot and the discussion lasts as long
        # as all the turns together.
        order = electorate * rounds
        slot = game.timing.speaker_max_seconds
        return select_speaker(game, instant, last_seen, order, 0, slot, instant + slot * len(order))
    slot = min(game.timing.speaker_max_seconds, game.timing.discussion_seconds // len(electorate))
    return select_speaker(game, instant, last_seen, electorate, 0, slot,
                          instant + game.timing.discussion_seconds)


def resolve(game: sim.Game, instant: float, option_id: str | None,
            contribution_ids: tuple[UUID, ...], method: str) -> sim.Game:
    tally = Counter(dict(game.ballots).values())
    counts = tuple((option.option_id, tally[option.option_id])
                   for option in options(game))
    selected = next((item for item in options(game) if item.option_id == option_id), None)
    if selected is not None and selected.kind == "ai":
        # The outcome was validated against allowed_custom_outcome_ids when the option was drafted.
        ai = game.ai_options
        candidate = sim.transition(replace(game, phase=sim.DecisionPhase(game.phase.phase_id)),
                                   sim.ResolveCustom(selected.option_id, selected.label, selected.outcome_id),
                                   instant, at(game, instant), sim.TransitionIds(uuid4(), uuid4(), uuid4()),
                                   contribution_ids)
        record = replace(candidate.history[-1], resolution_kind="ai", vote_counts=counts, selection_method=method,
                         ai_job_id=ai.ready_job_id if ai is not None and ai.round_id == game.round_id else None)
        return replace(candidate, last_tally=counts, history=candidate.history[:-1] + (record,))
    if selected is not None and selected.kind == "custom":
        job = uuid4()
        resolution = sim.Resolution(job, 1, selected.option_id, selected.member_id, selected.label,
                                    hashlib.sha256(selected.label.encode()).hexdigest(), method)
        return replace(game, phase=sim.ResolvingPhase(uuid4(), instant + 15, job, 1),
                       resolution=resolution, last_tally=counts)
    event = sim.ResolvePrepared(option_id) if option_id else sim.ResolveNoDecision()
    candidate = sim.transition(replace(game, phase=sim.DecisionPhase(game.phase.phase_id)), event,
                               instant, at(game, instant), sim.TransitionIds(uuid4(), uuid4(), uuid4()),
                               contribution_ids)
    record = replace(candidate.history[-1], vote_counts=counts, selection_method=method)
    return replace(candidate, last_tally=counts, history=candidate.history[:-1] + (record,))


def complete_custom(game: sim.Game, instant: float, outcome_id: str,
                    contribution_ids: tuple[UUID, ...]) -> sim.Game:
    job = game.resolution
    candidate = sim.transition(replace(game, phase=sim.DecisionPhase(game.phase.phase_id)),
                               sim.ResolveCustom(job.option_id, job.text, outcome_id), instant,
                               at(game, instant), sim.TransitionIds(uuid4(), uuid4(), uuid4()), contribution_ids)
    record = replace(candidate.history[-1], vote_counts=game.last_tally, selection_method=job.selection_method,
                     ai_job_id=job.job_id, ai_attempt=job.attempt, proposer_id=job.member_id)
    return replace(candidate, history=candidate.history[:-1] + (record,),
                   resolution=replace(job, status="ready", error=None))


def reconcile(game: sim.Game, now: float, roster: tuple[tuple[UUID, int, float], ...],
              evidence: tuple[tuple[UUID, UUID], ...]) -> sim.Game:
    """Total expiry wins; otherwise catch up elapsed phases in deadline order."""
    if game.session_deadline is not None and now >= game.session_deadline:
        if isinstance(game.phase, sim.PrivateSessionPhase) and game.phase.deadline <= game.session_deadline:
            # The private deadline extended the session ceiling, so it closes with the private ending.
            return finish_private_session(game, game.phase.deadline)
        return end(game, game.session_deadline, "total_timeout")
    last_seen = {member: seen for member, _, seen in roster}
    while not isinstance(game.phase, sim.EndedPhase):
        phase = game.phase
        due = deadline(game)
        reason = "elapsed"
        if isinstance(phase, sim.SpeakingPhase):
            disconnected_at = last_seen[phase.order[phase.index]] + PRESENCE_WINDOW_SECONDS
            if disconnected_at < due:
                due, reason = max(phase.started_at, disconnected_at), "disconnected"
        if due is None or now < due:
            return game
        electorate = tuple(member for member, eligible, _ in roster if eligible <= game.round_number)
        contributions = tuple(identity for identity, round_id in evidence if round_id == game.round_id)
        if isinstance(phase, sim.BriefingPhase):
            game = replace(game, phase=sim.ReadingPhase(uuid4(), due + game.timing.reading_seconds))
        elif isinstance(phase, sim.ReadingPhase):
            game = begin_speaking(game, due, electorate, last_seen)
        elif isinstance(phase, sim.SpeakingPhase):
            game = next_speaker(game, due, last_seen, reason)
        elif isinstance(phase, sim.DiscussionPhase) and decision_mode(game) == "individual":
            game = begin_individual_decision(game, due)
        elif isinstance(phase, sim.IndividualDecisionPhase):
            game = finish_individual_decision(game, due, electorate)
        elif isinstance(phase, sim.PrivateSessionPhase):
            game = finish_private_session(game, due)
        elif isinstance(phase, sim.DiscussionPhase):
            game = replace(freeze(game), phase=sim.VotingPhase(uuid4(), due + game.timing.voting_seconds),
                           ballots=(), last_tally=())
        elif isinstance(phase, sim.VotingPhase):
            counts = Counter(dict(game.ballots).values())
            high = max(counts.values(), default=0)
            leaders = tuple(sorted(option for option, count in counts.items() if count == high))
            if high and len(leaders) > 1:
                game = replace(game, phase=sim.TiePhase(uuid4(), due + game.timing.tie_seconds, leaders),
                               last_tally=tuple(sorted(counts.items())))
            else:
                game = resolve(game, due, leaders[0] if high else None, contributions,
                               "vote" if high else "no_decision")
        elif isinstance(phase, sim.TiePhase):
            game = resolve(game, due, None, contributions, "tie_timeout")
        elif isinstance(phase, sim.ResolvingPhase):
            game = replace(game, phase=sim.ResolutionFailedPhase(uuid4()),
                           resolution=replace(game.resolution, status="failed", error="AI resolution exceeded its 15 second deadline"))
        elif isinstance(phase, sim.ResultPhase):
            game = replace(game, node_id=phase.next_node_id, round_number=game.round_number + 1,
                           round_id=uuid4(), phase=sim.ReadingPhase(uuid4(), due + game.timing.reading_seconds),
                           ballots=(), last_tally=(), proposals=(), frozen_options=(), resolution=None,
                           ai_options=None, options_source=None)
        else:
            return game
    return game
