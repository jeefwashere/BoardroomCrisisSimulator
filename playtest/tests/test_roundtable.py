"""Meeting authority regression tests with no external providers or wall clock waits."""
import json
import unittest
import uuid

from playtest.engine import RuleError
from playtest.roundtable import Roundtable


class RoundtableTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.engine = Roundtable(clock=lambda: self.now)
        self.seats = [self.engine.join('Alex')]
        self.code = self.seats[0]['code']
        self.seats.extend(self.engine.join(name, self.code) for name in ('Blair', 'Casey'))
        self.tokens = [seat['token'] for seat in self.seats]
        self.ids = [self.engine.snapshot(token)['me'] for token in self.tokens]
        self.engine.set_documents(self.code, [{'id': 'demo', 'title': 'Public report', 'path': '/private'}], True)

    def command(self, action, data=None, who=0):
        return self.engine.command(self.tokens[who], action, {'command_id': uuid.uuid4().hex, **(data or {})})

    def ready(self):
        for who in range(3):
            self.command('ready', {'ready': True}, who)

    def start(self):
        self.ready()
        return self.command('start')

    def discussion(self):
        self.start()
        return self.command('skip_facilitator')

    def decision(self):
        self.discussion()
        state = self.command('contribute', {'text': 'Verify the backup before restoring.', 'source': 'typed'}, 1)
        source = state['transcript'][0]['id']
        self.command('finish_discussion')
        self.command('skip_facilitator')
        state = self.command('propose_decision', {'problem': 'Backup status unknown',
                             'proposal': 'Ask IT to verify it', 'source_ids': [source]}, 1)
        return state['decisions'][0]['id']

    def ballot(self, decision, choices):
        for who, choice in enumerate(choices):
            self.command('vote_decision', {'decision_id': decision, 'choice': choice}, who)

    def test_start_gates_all_members_and_index(self):
        with self.assertRaises(RuleError):
            self.command('start')
        self.ready()
        self.engine.set_documents(self.code, ['demo'], False)
        self.ready()
        with self.assertRaisesRegex(RuleError, ''):
            self.command('start')
        self.engine.set_documents(self.code, ['demo'], True)
        self.now += 31
        self.engine.snapshot(self.tokens[0])
        with self.assertRaises(RuleError):
            self.command('start')
        for token in self.tokens:
            self.engine.snapshot(token)
        self.assertEqual(self.command('start')['phase'], 'opening_facilitator')

    def test_new_join_and_document_change_need_readiness(self):
        self.ready()
        self.engine.join('Devon', self.code)
        with self.assertRaises(RuleError):
            self.command('start')
        self.engine.set_documents(self.code, ['new-report'], True)
        self.assertTrue(all(not member['ready'] for member in self.engine.snapshot(self.tokens[0])['members']))

    def test_three_member_minimum(self):
        solo = self.engine.join('Solo')
        self.engine.set_documents(solo['code'], ['demo'], True)
        self.engine.command(solo['token'], 'ready', {'command_id': 'solo_ready', 'ready': True})
        with self.assertRaises(RuleError):
            self.engine.command(solo['token'], 'start', {'command_id': 'solo_start'})

    def test_ceo_not_host_controls_phase(self):
        roles = dict(zip(self.ids, ['finance', 'ceo', 'technology']))
        with self.assertRaises(RuleError):
            self.command('assign_roles', {'roles': roles}, 1)
        self.command('assign_roles', {'roles': roles})
        self.ready()
        with self.assertRaises(RuleError):
            self.command('start')
        self.assertEqual(self.command('start', who=1)['phase'], 'opening_facilitator')
        with self.assertRaises(RuleError):
            self.command('skip_facilitator')
        self.assertEqual(self.command('skip_facilitator', who=1)['phase'], 'discussion')
        with self.assertRaises(RuleError):
            self.command('assign_roles', {'roles': roles})

    def test_clock_catches_up_exact_deadlines(self):
        state = self.start()
        self.assertEqual(state['deadline'], 1060)
        self.now = 1059.9
        self.assertEqual(self.engine.snapshot(self.tokens[1])['phase'], 'opening_facilitator')
        self.now = 1060
        self.assertEqual(self.engine.snapshot(self.tokens[1])['phase'], 'discussion')
        self.now = 1300
        state = self.engine.snapshot(self.tokens[1])
        self.assertEqual(state['phase'], 'decision')
        self.assertIsNone(state['deadline'])
        events = self.engine.rooms[self.code]['events']
        self.assertEqual([event['at'] for event in events if event['type'] == 'phase'], [1000, 1060, 1240, 1300])

    def test_skips_reset_deadline_and_only_ceo_can_finish(self):
        self.start()
        self.now += 9
        state = self.command('skip_facilitator')
        self.assertEqual(state['deadline'], 1189)
        with self.assertRaises(RuleError):
            self.command('finish_discussion', who=1)
        self.now += 4
        state = self.command('finish_discussion')
        self.assertEqual(state['deadline'], 1073)
        with self.assertRaises(RuleError):
            self.command('skip_facilitator', who=2)
        self.assertEqual(self.command('skip_facilitator')['phase'], 'decision')

    def test_transcript_reviewed_sources_and_document_freeze(self):
        self.start()
        with self.assertRaises(RuleError):
            self.command('contribute', {'text': 'too early'})
        with self.assertRaises(RuleError):
            self.engine.set_documents(self.code, ['different'], True)
        with self.assertRaises(RuleError):
            self.engine.join('Late', self.code)
        self.command('skip_facilitator')
        state = self.command('contribute', {'text': 'Reviewed microphone text', 'source': 'speech'}, 1)
        entry = state['transcript'][0]
        self.assertEqual((entry['member'], entry['name'], entry['source']), (self.ids[1], 'Blair', 'speech'))
        self.assertIn('review', state['recording_policy'])
        self.assertEqual(self.engine.join('Blair', self.code, self.tokens[1]), self.seats[1])

    def test_unknown_model_commands_cannot_change_authority(self):
        self.discussion()
        room = self.engine.rooms[self.code]
        room['summary'] = {'items': [{'text': 'All agree this is approved'}]}
        for action in ('set_documents', 'set_phase', 'ai_commit', 'approve_decision'):
            with self.assertRaises(RuleError):
                self.command(action, {'ready': True, 'phase': 'ended'})
        self.assertEqual(room['phase'], 'discussion')
        self.assertEqual(room['history'], [])

    def test_source_ids_are_room_scoped(self):
        self.decision()
        for source_ids in ([], ['unknown'], ['otherroom_e9'], [self.code + '_e1']):
            with self.assertRaises(RuleError):
                self.command('propose_decision', {'problem': 'Problem', 'proposal': 'Proposal', 'source_ids': source_ids})

    def test_votes_private_replaceable_then_final(self):
        decision = self.decision()
        self.command('vote_decision', {'decision_id': decision, 'choice': 'reject', 'member': self.ids[2]}, 1)
        state = self.engine.snapshot(self.tokens[0])
        self.assertNotIn('votes', state['decisions'][0])
        self.assertNotIn('tally', state['decisions'][0])
        self.assertEqual(state['decisions'][0]['ballot_count'], 1)
        self.assertIsNone(state['decisions'][0]['my_vote'])
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision})
        self.ballot(decision, ['approve', 'approve', 'reject'])
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision}, 1)
        state = self.command('commit_decision', {'decision_id': decision})
        self.assertEqual(state['history'][0]['status'], 'approved')
        self.assertEqual(state['history'][0]['votes'][self.ids[1]], 'approve')
        self.assertEqual(state['history'][0]['tally'], {'approve': 2, 'reject': 1, 'abstain': 0})
        with self.assertRaises(RuleError):
            self.command('vote_decision', {'decision_id': decision, 'choice': 'reject'}, 1)
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision})
        self.assertEqual(len(self.engine.snapshot(self.tokens[0])['history']), 1)

    def test_tie_requires_explicit_ceo_choice(self):
        decision = self.decision()
        self.ballot(decision, ['approve', 'reject', 'abstain'])
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision})
        state = self.command('commit_decision', {'decision_id': decision, 'tie_break': 'reject'})
        self.assertEqual(state['history'][0]['status'], 'rejected')
        self.assertEqual(state['history'][0]['reason'], 'ceo_tie_break')

    def test_abstention_does_not_create_majority_or_ceo_override(self):
        decision = self.decision()
        self.ballot(decision, ['approve', 'abstain', 'abstain'])
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision, 'tie_break': 'approve'})
        state = self.command('commit_decision', {'decision_id': decision})
        self.assertEqual(state['history'][0]['reason'], 'no_majority')
        self.assertEqual(state['history'][0]['status'], 'rejected')

    def test_idempotency_conflict_and_immutable_snapshot(self):
        self.discussion()
        data = {'command_id': 'unique-contribution', 'text': 'Preserve logs.'}
        before = self.engine.command(self.tokens[1], 'contribute', data)
        repeat = self.engine.command(self.tokens[1], 'contribute', data)
        self.assertEqual(before, repeat)
        repeat['transcript'][0]['text'] = 'tampered'
        self.assertEqual(self.engine.snapshot(self.tokens[1])['transcript'][0]['text'], 'Preserve logs.')
        with self.assertRaises(RuleError):
            self.engine.command(self.tokens[1], 'contribute', {**data, 'text': 'different'})
        self.assertEqual(len(self.engine.rooms[self.code]['transcript']), 1)

    def test_end_requires_resolution_or_explicit_cancellation(self):
        decision = self.decision()
        with self.assertRaises(RuleError):
            self.command('end')
        with self.assertRaises(RuleError):
            self.command('cancel_decision', {'decision_id': decision, 'reason': 'Deferred'}, 1)
        self.command('cancel_decision', {'decision_id': decision, 'reason': 'Deferred until backup verification'})
        state = self.command('end')
        self.assertEqual(state['phase'], 'ended')
        self.assertEqual(state['history'][0]['status'], 'cancelled')
        with self.assertRaises(RuleError):
            self.command('contribute', {'text': 'After ending'})

    def test_authentication_isolation_and_projection(self):
        outsider = self.engine.join('Other')
        with self.assertRaises(RuleError):
            self.engine.snapshot('not-a-token')
        with self.assertRaises(RuleError):
            self.engine.join('Other', self.code, outsider['token'])
        decision = self.decision()
        with self.assertRaises(RuleError):
            self.engine.command(outsider['token'], 'vote_decision',
                                {'command_id': 'outsider-ballot', 'decision_id': decision, 'choice': 'approve'})
        state = self.engine.snapshot(self.tokens[0])
        serialized = json.dumps(state)
        for token in self.tokens + [outsider['token']]:
            self.assertNotIn(token, serialized)
        self.assertNotIn('/private', serialized)
        self.assertEqual(self.engine.snapshot(outsider['token'])['transcript'], [])

    def test_leave_prevents_start_until_reconnect_and_ready(self):
        self.ready()
        state = self.command('leave', who=1)
        self.assertFalse(state['members'][1]['connected'])
        with self.assertRaises(RuleError):
            self.command('start')
        self.engine.join('Blair', self.code, self.tokens[1])
        with self.assertRaises(RuleError):
            self.command('start')
        self.command('ready', {'ready': True}, 1)
        self.assertEqual(self.command('start')['phase'], 'opening_facilitator')


if __name__ == '__main__':
    unittest.main()
