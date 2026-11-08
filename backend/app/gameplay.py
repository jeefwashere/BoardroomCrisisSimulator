"""Deterministic gameplay scheduling. Rooms publishes all results under its lock."""

from collections import Counter
from dataclasses import replace
from datetime import timedelta
from uuid import UUID, uuid4

from . import simulation as sim
from .rules import PRESENCE_WINDOW_SECONDS


def at(game: sim.Game, instant: float):
    return game.started_at + timedelta(seconds=instant - game.started_mono)


def deadline(game: sim.Game) -> float | None:
    phase = game.phase
    if isinstance(phase, (sim.BriefingPhase, sim.ResultPhase)):
        return phase.not_before
    return getattr(phase, "deadline", None)


def end(game: sim.Game, instant: float, reason: str) -> sim.Game:
    if isinstance(game.phase, sim.EndedPhase):
        return game
    if isinstance(game.phase, sim.SpeakingPhase):
        game = finish_record(game, instant, reason)
    return replace(game, phase=sim.EndedPhase(uuid4(), reason), ended_at=at(game, instant))


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
    return replace(game, phase=sim.DiscussionPhase(uuid4(), discussion_deadline))


def next_speaker(game: sim.Game, instant: float, last_seen: dict[UUID, float],
                 reason: str, actor_id: UUID | None = None) -> sim.Game:
    phase = game.phase
    game = finish_record(game, instant, reason, actor_id)
    return select_speaker(game, instant, last_seen, phase.order, phase.index + 1,
                          phase.slot_seconds, phase.discussion_deadline)


def begin_speaking(game: sim.Game, instant: float, electorate: tuple[UUID, ...],
                   last_seen: dict[UUID, float]) -> sim.Game:
    slot = min(game.timing.speaker_max_seconds, game.timing.discussion_seconds // len(electorate))
    return select_speaker(game, instant, last_seen, electorate, 0, slot,
                          instant + game.timing.discussion_seconds)


def resolve(game: sim.Game, instant: float, option_id: str | None,
            contribution_ids: tuple[UUID, ...], method: str) -> sim.Game:
    tally = Counter(dict(game.ballots).values())
    counts = tuple((option.option_id, tally[option.option_id])
                   for option in sim.current_node(game).options)
    event = sim.ResolvePrepared(option_id) if option_id else sim.ResolveNoDecision()
    candidate = sim.transition(replace(game, phase=sim.DecisionPhase(game.phase.phase_id)), event,
                               instant, at(game, instant), sim.TransitionIds(uuid4(), uuid4(), uuid4()),
                               contribution_ids)
    record = replace(candidate.history[-1], vote_counts=counts, selection_method=method)
    return replace(candidate, last_tally=counts, history=candidate.history[:-1] + (record,))


def reconcile(game: sim.Game, now: float, roster: tuple[tuple[UUID, int, float], ...],
              evidence: tuple[tuple[UUID, UUID], ...]) -> sim.Game:
    """Total expiry wins; otherwise catch up elapsed phases in deadline order."""
    if game.session_deadline is not None and now >= game.session_deadline:
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
        elif isinstance(phase, sim.DiscussionPhase):
            game = replace(game, phase=sim.VotingPhase(uuid4(), due + game.timing.voting_seconds),
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
        elif isinstance(phase, sim.ResultPhase):
            game = replace(game, node_id=phase.next_node_id, round_number=game.round_number + 1,
                           round_id=uuid4(), phase=sim.ReadingPhase(uuid4(), due + game.timing.reading_seconds),
                           ballots=(), last_tally=())
        else:
            return game
    return game
