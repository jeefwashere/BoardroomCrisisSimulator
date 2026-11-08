"""Narrative acceptance checks use authored expectations and trusted internal events."""

from dataclasses import FrozenInstanceError, asdict
from itertools import product
import unittest
from uuid import uuid4

from backend.app import simulation as sim
from backend.app.rooms import RoomError, Rooms, StartSpec
from backend.app.scenarios import ScenarioCatalog


class FakeClock:
    def __init__(self):
        self.value = 0.0

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


class NarrativeEngineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = FakeClock()
        self.rooms = Rooms(ScenarioCatalog(), self.clock, automatic=False)
        self.counter = 0

    async def create_started(self):
        self.counter += 1
        code = f"ENG{self.counter:03d}"
        sessions = tuple(self.rooms.session(None) for _ in range(3))
        host = await self.rooms.create(sessions[0], uuid4(), code, "Alex")
        second = await self.rooms.join(sessions[1], uuid4(), code, "Blair")
        third = await self.rooms.join(sessions[2], uuid4(), code, "Casey")
        ids = (host.self_member_id, second.self_member_id, third.self_member_id)
        spec = StartSpec(code, "maplecart_cybersecurity", 3, "standard_18",
                         tuple(zip(ids, ("ceo", "security", "technology"))))
        start_id = uuid4()
        view = await self.rooms.start(sessions[0], host.room_id, start_id, spec)
        return view, sessions, spec, start_id

    async def begin(self, view):
        self.clock.advance(90)
        return await self.rooms.transition_internal(
            view.room_id, uuid4(), view.game.phase_id, sim.BeginDecision())

    async def event(self, room_id, state, event):
        return await self.rooms.transition_internal(room_id, uuid4(), state.phase.phase_id, event)

    async def advance(self, room_id, state):
        self.clock.advance(30)
        return await self.event(room_id, state, sim.AdvanceResult())

    async def finish(self, room_id, state, choices=("contain_targeted", "communicate_facts", "recover_staged")):
        for index, choice in enumerate(choices):
            event = sim.ResolvePrepared(choice) if choice is not None else sim.ResolveNoDecision()
            state = await self.event(room_id, state, event)
            if index < len(choices) - 1:
                state = await self.advance(room_id, state)
        return state

    async def expect_error(self, code, operation):
        with self.assertRaises(RoomError) as caught:
            await operation
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    async def test_all_64_prepared_and_no_decision_paths_preserve_facts_and_end(self):
        containment = {
            "contain_targeted": (160, "targeted", "storefront_monitored_finance_isolated"),
            "contain_wait": (5000, "delayed", "storefront_available_finance_disruption_growing"),
            "contain_broad": (160, "broad_shutdown", "checkout_and_support_offline"),
            None: (5000, "no_decision", "storefront_available_finance_disruption_growing"),
        }
        communication = {
            "communicate_facts": "factual_update_and_owned_followup",
            "communicate_deny": "unsupported_assurance_requires_correction",
            "communicate_silence": "public_update_delayed",
            None: "no_communication_decision",
        }
        recovery = {
            "recover_staged": ("staged_recovery_planned_not_completed", "controlled_recovery_plan"),
            "recover_rushed": ("risky_restoration_authorized", "high_risk_recovery_decision"),
            "recover_rebuild": ("extended_rebuild_planned_not_completed", "assurance_prioritized_delay"),
            None: ("no_recovery_decision", "incomplete_recovery_decision"),
        }
        completed = 0
        for choices in product(containment, communication, recovery):
            with self.subTest(choices=choices):
                view, sessions, _, _ = await self.create_started()
                state = await self.begin(view)
                state = await self.finish(view.room_id, state, choices)
                self.assertEqual(state.phase.kind, "ended")
                self.assertEqual(state.phase.ending_label, recovery[choices[2]][1])
                self.assertEqual(state.round_number, 3)
                self.assertEqual(tuple(record.node_id for record in state.history),
                                 ("containment", "communication", "recovery"))
                self.assertEqual(tuple(record.round_number for record in state.history), (1, 2, 3))
                self.assertEqual(tuple(record.selected_option_id for record in state.history), choices)
                self.assertEqual(len({record.round_id for record in state.history}), 3)
                count, response, service = containment[choices[0]]
                facts = dict(state.facts)
                self.assertEqual(facts, {
                    "verified_export_records": count,
                    "export_status": "confirmed_minimum_scope_incomplete",
                    "containment": response, "service_condition": service,
                    "communication_status": communication[choices[1]],
                    "recovery_status": recovery[choices[2]][0],
                })
                first, second, third = state.history
                self.assertEqual(dict(first.facts_after)["communication_status"], "none")
                self.assertEqual(dict(first.facts_after)["recovery_status"], "not_started")
                self.assertEqual(second.facts_before, first.facts_after)
                self.assertEqual(third.facts_before, second.facts_after)
                for record in state.history:
                    self.assertEqual(dict(record.facts_after)["verified_export_records"], count)
                snapshot = await self.rooms.snapshot(sessions[0], view.room_id)
                self.assertEqual(snapshot.game.last_result, third)
                self.assertEqual(snapshot.game.history, state.history)
                self.assertIsNone(snapshot.game.current_node)
                for forbidden in ("initial_metrics", "metrics", "metric_deltas", "applied_deltas"):
                    self.assertNotIn(forbidden, asdict(snapshot.game))
                    self.assertFalse(hasattr(state, forbidden))
                completed += 1
        self.assertEqual(completed, 64)

    async def test_exact_briefing_and_result_guards_require_internal_driver(self):
        view, sessions, _, _ = await self.create_started()
        rid = view.room_id
        briefing_id = view.game.phase_id
        self.assertEqual(view.phase, "briefing")
        self.assertIsNone(view.game.current_node)
        self.clock.value = 89.999
        await self.expect_error("phase_not_elapsed", self.rooms.transition_internal(
            rid, uuid4(), briefing_id, sim.BeginDecision()))
        self.clock.value = 90
        self.assertEqual((await self.rooms.snapshot(sessions[0], rid)).phase, "briefing")
        decision = await self.rooms.transition_internal(rid, uuid4(), briefing_id, sim.BeginDecision())
        result = await self.event(rid, decision, sim.ResolvePrepared("contain_targeted"))
        self.assertEqual(result.phase.kind, "result")
        self.clock.value = 119.999
        await self.expect_error("phase_not_elapsed", self.event(rid, result, sim.AdvanceResult()))
        self.clock.value = 120
        self.assertEqual((await self.rooms.snapshot(sessions[0], rid)).phase, "result")
        next_round = await self.event(rid, result, sim.AdvanceResult())
        self.assertEqual(next_round.round_number, 2)
        self.assertEqual(next_round.node_id, "communication")
        self.assertNotEqual(next_round.phase.phase_id, result.phase.phase_id)
        terminal = await self.finish(rid, next_round, ("communicate_facts", "recover_rebuild"))
        terminal_time = self.clock.value
        self.assertEqual(terminal.phase.kind, "ended")
        self.assertEqual(terminal.phase.ending_label, "assurance_prioritized_delay")
        self.clock.advance(100000)
        after = await self.rooms.snapshot(sessions[0], rid)
        self.assertEqual(after.phase, "ended")
        self.assertEqual(after.game.last_result.text, terminal.history[-1].text)
        self.assertEqual(len(after.game.history), 3)
        self.assertEqual(terminal_time, 150)
        await self.expect_error("game_ended", self.event(rid, terminal, sim.AdvanceResult()))

    async def test_internal_replays_conflicts_staleness_and_unknown_option_rollback(self):
        view, sessions, spec, start_id = await self.create_started()
        rid = view.room_id
        initial_copy = asdict(view)
        state = await self.begin(view)
        before = await self.rooms.snapshot(sessions[0], rid)
        invalid_id = uuid4()
        await self.expect_error("option_not_found", self.rooms.transition_internal(
            rid, invalid_id, state.phase.phase_id, sim.ResolvePrepared("not_authored")))
        after = await self.rooms.snapshot(sessions[0], rid)
        self.assertEqual(after.room_version, before.room_version)
        self.assertEqual(after.game, before.game)
        self.assertNotIn((rid, invalid_id), self.rooms.internal_receipts)
        event_id = uuid4()
        result = await self.rooms.transition_internal(rid, event_id, state.phase.phase_id,
                                                      sim.ResolvePrepared("contain_targeted"))
        result_copy = asdict(result)
        next_state = await self.advance(rid, result)
        replay = await self.rooms.transition_internal(rid, event_id, state.phase.phase_id,
                                                      sim.ResolvePrepared("contain_targeted"))
        self.assertIs(replay, result)
        self.assertEqual(asdict(replay), result_copy)
        await self.expect_error("command_conflict", self.rooms.transition_internal(
            rid, event_id, state.phase.phase_id, sim.ResolveNoDecision()))
        await self.expect_error("command_conflict", self.rooms.transition_internal(
            rid, event_id, next_state.phase.phase_id, sim.ResolvePrepared("contain_targeted")))
        await self.expect_error("stale_phase", self.rooms.transition_internal(
            rid, uuid4(), state.phase.phase_id, sim.ResolveNoDecision()))
        final = await self.rooms.snapshot(sessions[0], rid)
        self.assertEqual(final.game.phase_id, next_state.phase.phase_id)
        self.assertEqual(len(final.game.history), 1)
        self.assertEqual(state.history, ())
        self.assertEqual(dict(state.facts)["verified_export_records"], 0)
        self.assertEqual(asdict(view), initial_copy)
        old_start = await self.rooms.start(sessions[0], rid, start_id, spec)
        self.assertIs(old_start, view)
        self.assertEqual(old_start.phase, "briefing")
        with self.assertRaises(FrozenInstanceError):
            result.history[0].text = "Rewritten"
        with self.assertRaises(TypeError):
            result.history[0].facts_after[0] = ("containment", "rewritten")

    async def test_current_situation_uses_committed_facts_and_snapshot_copies(self):
        view, sessions, _, _ = await self.create_started()
        state = await self.begin(view)
        first = await self.rooms.snapshot(sessions[0], view.room_id)
        self.assertEqual(len(first.game.current_node.options), 3)
        self.assertFalse(hasattr(first.game.current_node, "outcomes"))
        result = await self.event(view.room_id, state, sim.ResolvePrepared("contain_wait"))
        state = await self.advance(view.room_id, result)
        communication = await self.rooms.snapshot(sessions[0], view.room_id)
        self.assertIn("5000 records", communication.game.current_node.situation)
        self.assertIn("storefront_available_finance_disruption_growing", communication.game.current_node.situation)
        self.assertNotIn("{{", communication.game.current_node.situation)
        facts = communication.game.facts
        facts["verified_export_records"] = 0
        self.assertEqual(communication.game.facts["verified_export_records"], 5000)
        result = await self.event(view.room_id, state, sim.ResolvePrepared("communicate_deny"))
        state = await self.advance(view.room_id, result)
        recovery = await self.rooms.snapshot(sessions[0], view.room_id)
        self.assertIn("unsupported_assurance_requires_correction", recovery.game.current_node.situation)
        self.assertIn("5000 records", recovery.game.current_node.situation)
        self.assertEqual(first.game.facts["verified_export_records"], 0)
        self.assertEqual(result.history[-1].question, communication.game.current_node.situation)

    async def test_late_joins_in_decision_and_result_preserve_frozen_electorate(self):
        view, sessions, _, _ = await self.create_started()
        state = await self.begin(view)
        electorate = view.game.eligible_member_ids
        late_decision = self.rooms.session(None)
        joined = await self.rooms.join(late_decision, uuid4(), view.room_code, "Dana", "finance")
        self.assertEqual(joined.game.eligible_member_ids, electorate)
        dana = next(member for member in joined.members if member.display_name == "Dana")
        self.assertEqual(dana.eligible_from_round, 2)
        self.assertFalse(dana.eligible_current_round)
        await self.expect_error("answer_not_allowed", self.rooms.contribute(
            late_decision, view.room_id, uuid4(), state.phase.phase_id, "answer", "typed", "Wait"))
        chat = await self.rooms.contribute(late_decision, view.room_id, uuid4(),
                                           state.phase.phase_id, "chat", "typed", "I joined to observe")
        self.assertEqual(chat.role_id, "finance")
        await self.expect_error("ceo_reserved", self.rooms.join(
            self.rooms.session(None), uuid4(), view.room_code, "Replacement CEO", "ceo"))
        result = await self.event(view.room_id, state, sim.ResolvePrepared("contain_targeted"))
        late_result = self.rooms.session(None)
        joined_result = await self.rooms.join(late_result, uuid4(), view.room_code, "Eli", "operations")
        self.assertEqual(joined_result.game.eligible_member_ids, electorate)
        eli = next(member for member in joined_result.members if member.display_name == "Eli")
        self.assertEqual(eli.eligible_from_round, 2)
        self.assertFalse(eli.eligible_current_round)
        next_state = await self.advance(view.room_id, result)
        admitted = await self.rooms.snapshot(sessions[0], view.room_id)
        self.assertEqual(set(admitted.game.eligible_member_ids), set(electorate) | {dana.member_id, eli.member_id})
        for session in (late_decision, late_result):
            await self.rooms.contribute(session, view.room_id, uuid4(), next_state.phase.phase_id,
                                        "answer", "typed", "Publish known facts")
        self.assertEqual(view.game.eligible_member_ids, electorate)
        terminal = await self.finish(view.room_id, next_state, ("communicate_facts", "recover_staged"))
        await self.expect_error("game_ended", self.rooms.join(
            self.rooms.session(None), uuid4(), view.room_code, "Frank", "finance"))
        rejoined = await self.rooms.join(sessions[1], uuid4(), view.room_code, "Blair", "security")
        self.assertEqual(rejoined.self_member_id, electorate[1])
        self.assertEqual(rejoined.game.history, terminal.history)
        await self.expect_error("role_locked", self.rooms.join(
            sessions[1], uuid4(), view.room_code, "Blair", "ceo"))

    async def test_all_contributions_keep_actor_role_source_sequence_and_freeze_at_end(self):
        view, sessions, _, _ = await self.create_started()
        rid = view.room_id
        await self.expect_error("evidence_not_final", self.rooms.evaluation_evidence(sessions[0], rid))
        await self.expect_error("answer_not_allowed", self.rooms.contribute(
            sessions[0], rid, uuid4(), view.game.phase_id, "answer", "typed", "Too early"))
        briefing_chat = await self.rooms.contribute(sessions[1], rid, uuid4(), view.game.phase_id,
                                                   "chat", "typed", "What is actually confirmed?")
        state = await self.begin(view)
        records = [briefing_chat]
        for session, source, text in (
            (sessions[0], "typed", "Keep all services running"),
            (sessions[0], "typed", "Keep all services running"),
            (sessions[1], "speech", "Isolate finance and preserve available logs"),
            (sessions[2], "typed", "Shut down all services"),
        ):
            records.append(await self.rooms.contribute(session, rid, uuid4(), state.phase.phase_id,
                                                       "answer", source, text))
        chat_id = uuid4()
        chat = await self.rooms.contribute(sessions[2], rid, chat_id, state.phase.phase_id,
                                           "chat", "speech", "Reviewed: the export is still unconfirmed.")
        records.append(chat)
        self.assertIs(await self.rooms.contribute(sessions[2], rid, chat_id, state.phase.phase_id,
                                                  "chat", "speech", chat.text), chat)
        await self.expect_error("command_conflict", self.rooms.contribute(
            sessions[2], rid, chat_id, state.phase.phase_id, "chat", "speech", "Changed text"))
        result = await self.event(rid, state, sim.ResolvePrepared("contain_targeted"))
        frozen_ids = result.history[0].contribution_ids
        self.assertEqual(frozen_ids, tuple(record.contribution_id for record in records))
        await self.expect_error("answer_not_allowed", self.rooms.contribute(
            sessions[0], rid, uuid4(), result.phase.phase_id, "answer", "typed", "Too late"))
        await self.expect_error("stale_phase", self.rooms.contribute(
            sessions[0], rid, uuid4(), state.phase.phase_id, "chat", "typed", "Old phase"))
        result_chat = await self.rooms.contribute(sessions[1], rid, uuid4(), result.phase.phase_id,
                                                  "chat", "speech", "Reviewed: we now know at least 160 records.")
        records.append(result_chat)
        self.assertEqual(result.history[0].contribution_ids, frozen_ids)
        self.assertNotIn(result_chat.contribution_id, frozen_ids)
        next_state = await self.advance(rid, result)
        round_two_answer = await self.rooms.contribute(
            sessions[0], rid, uuid4(), next_state.phase.phase_id, "answer", "typed", "Publish facts and own the next update")
        records.append(round_two_answer)
        second_result = await self.event(rid, next_state, sim.ResolvePrepared("communicate_facts"))
        self.assertEqual(second_result.history[-1].contribution_ids, (round_two_answer.contribution_id,))
        third_state = await self.advance(rid, second_result)
        round_three_answer = await self.rooms.contribute(
            sessions[2], rid, uuid4(), third_state.phase.phase_id, "answer", "speech", "Reviewed: validate the backup before restoration")
        records.append(round_three_answer)
        terminal = await self.event(rid, third_state, sim.ResolvePrepared("recover_staged"))
        self.assertEqual(terminal.history[-1].contribution_ids, (round_three_answer.contribution_id,))
        evidence = await self.rooms.evaluation_evidence(sessions[0], rid)
        self.assertEqual(evidence.contributions, tuple(records))
        self.assertEqual(tuple(record.sequence for record in records), tuple(range(1, len(records) + 1)))
        self.assertEqual(len({record.contribution_id for record in records}), len(records))
        actors = dict(zip(view.game.eligible_member_ids, ("ceo", "security", "technology")))
        for record in evidence.contributions:
            self.assertEqual(record.role_id, actors[record.member_id])
            self.assertEqual(record.node_id, ("containment", "communication", "recovery")[record.round_number - 1])
        self.assertEqual(tuple(record.round_number for record in evidence.contributions),
                         (1, 1, 1, 1, 1, 1, 1, 2, 3))
        self.assertEqual(records[1].member_id, records[2].member_id)
        self.assertEqual(records[1].text, records[2].text)
        self.assertNotEqual(records[1].contribution_id, records[2].contribution_id)
        self.assertEqual(records[3].source, "speech")
        self.assertEqual(records[3].text, "Isolate finance and preserve available logs")
        self.assertEqual(evidence.decisions, terminal.history)
        self.assertEqual(evidence.ending_label, "controlled_recovery_plan")
        self.assertEqual(len(evidence.members), 3)
        self.assertEqual(evidence.scenario.version, 3)
        self.assertEqual(evidence.public_documents, view.game.public_documents)
        self.assertLessEqual(evidence.started_at, evidence.ended_at)
        saved = asdict(evidence)
        await self.expect_error("game_ended", self.rooms.contribute(
            sessions[0], rid, uuid4(), terminal.phase.phase_id, "chat", "typed", "Post ending mutation"))
        self.assertIs(await self.rooms.contribute(sessions[2], rid, chat_id, state.phase.phase_id,
                                                  "chat", "speech", chat.text), chat)
        with self.assertRaises(FrozenInstanceError):
            evidence.contributions[0].text = "Rewritten"
        with self.assertRaises(TypeError):
            evidence.contributions[0] = result_chat
        await self.rooms.join(sessions[0], uuid4(), view.room_code, "Alex", "ceo")
        self.assertEqual(asdict(await self.rooms.evaluation_evidence(sessions[1], rid)), saved)

    async def test_invalid_contributions_and_nonmembers_cannot_enter_evidence(self):
        view, sessions, _, _ = await self.create_started()
        state = await self.begin(view)
        outsider = self.rooms.session(None)
        await self.expect_error("not_a_member", self.rooms.contribute(
            outsider, view.room_id, uuid4(), state.phase.phase_id, "chat", "typed", "Intrusion"))
        await self.expect_error("not_a_member", self.rooms.evaluation_evidence(outsider, view.room_id))
        for kind, source, text in (
            ("vote", "typed", "choice"), ("chat", "partial_speech", "Partial"),
            ("answer", "typed", ""), ("chat", "speech", "   "),
            ("chat", "typed", "x" * 4001),
        ):
            with self.subTest(kind=kind, source=source, length=len(text)):
                await self.expect_error("invalid_contribution", self.rooms.contribute(
                    sessions[0], view.room_id, uuid4(), state.phase.phase_id, kind, source, text))
        self.assertEqual(await self.rooms.contributions(sessions[0], view.room_id), ())

    async def test_rooms_are_isolated_even_with_the_same_internal_event_id(self):
        first, sessions_a, _, _ = await self.create_started()
        second, sessions_b, _, _ = await self.create_started()
        self.clock.advance(90)
        event_id = uuid4()
        state_a = await self.rooms.transition_internal(first.room_id, event_id, first.game.phase_id, sim.BeginDecision())
        state_b = await self.rooms.transition_internal(second.room_id, event_id, second.game.phase_id, sim.BeginDecision())
        await self.rooms.contribute(sessions_a[0], first.room_id, uuid4(), state_a.phase.phase_id,
                                    "answer", "typed", "Room A only")
        result_a = await self.event(first.room_id, state_a, sim.ResolvePrepared("contain_broad"))
        snapshot_b = await self.rooms.snapshot(sessions_b[0], second.room_id)
        self.assertEqual(snapshot_b.game.facts["verified_export_records"], 0)
        self.assertEqual(snapshot_b.game.history, ())
        self.assertEqual(snapshot_b.game.phase_id, state_b.phase.phase_id)
        self.assertEqual(await self.rooms.contributions(sessions_b[0], second.room_id), ())
        await self.expect_error("not_a_member", self.rooms.snapshot(sessions_a[0], second.room_id))
        result_b = await self.event(second.room_id, state_b, sim.ResolveNoDecision())
        self.assertEqual(dict(result_a.facts)["containment"], "broad_shutdown")
        self.assertEqual(dict(result_b.facts)["containment"], "no_decision")
        self.assertNotEqual(result_a.history[0].decision_id, result_b.history[0].decision_id)


if __name__ == "__main__":
    unittest.main()
