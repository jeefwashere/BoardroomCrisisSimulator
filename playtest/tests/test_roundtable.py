"""Meeting authority regression tests with no external providers or wall clock waits."""
import json
import unittest
import uuid

from playtest.engine import RuleError
from playtest.roundtable import Roundtable
from playtest.roundtable_scenario import DECISION


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
        for who in range(len(self.tokens)):
            self.command('ready', {'ready': True}, who)

    def start(self):
        self.ready()
        return self.command('start')

    def discussion(self):
        self.start()
        self.now += 30
        return self.engine.snapshot(self.tokens[0])

    def decision(self):
        self.discussion()
        self.command('next_turn')
        state = self.command('contribute', {'text': 'Verify the backup before restoring.', 'source': 'typed'}, 1)
        source = state['transcript'][0]['id']
        self.command('finish_discussion')
        self.command('skip_consultation')
        state = self.command('propose_decision', {'problem': 'Backup status unknown',
                             'proposal': 'Ask IT to verify it', 'source_ids': [source]}, 1)
        return state['decisions'][0]['id']

    def ballot(self, decision, choices):
        for who, choice in enumerate(choices):
            self.command('vote_decision', {'decision_id': decision, 'choice': choice}, who)

    def fixed_decision(self):
        self.engine.set_documents(self.code, ['T01'], True)
        self.discussion()
        self.command('contribute', {'text': 'We need an interim coordinator and backup checks.'})
        self.command('finish_discussion')
        self.assertEqual(self.engine.snapshot(self.tokens[0])['decisions'], [])
        state = self.command('skip_consultation')
        return state['decisions'][0]['id']

    def option_ballots(self, decision, choices):
        for who, option in enumerate(choices):
            self.command('vote_option', {'decision_id': decision, 'option_id': option}, who)

    def test_fixed_t01_ballot_opens_once_after_consultation(self):
        self.engine.set_documents(self.code, ['T01'], True)
        self.start()
        self.assertEqual(self.engine.snapshot(self.tokens[0])['fixed_scenario'], 'T01')
        self.assertEqual(self.engine.snapshot(self.tokens[0])['decisions'], [])
        self.now = 1389.9
        self.assertEqual(self.engine.snapshot(self.tokens[0])['phase'], 'consultation')
        self.assertEqual(self.engine.snapshot(self.tokens[0])['decisions'], [])
        self.now = 1390
        state = self.engine.snapshot(self.tokens[0])
        self.assertEqual(state['phase'], 'decision')
        decision = state['decisions'][0]
        self.assertEqual(decision['id'], 't01_response')
        self.assertEqual(decision['mode'], 'fixed_choice')
        self.assertEqual(decision['options'], DECISION['options'])
        self.assertEqual(decision['document_ids'], ['T01'])
        self.assertEqual(decision['status'], 'pending')
        self.assertEqual(decision['ballot_count'], 0)
        self.assertEqual(decision['voted_members'], [])
        self.assertIsNone(decision['my_vote'])
        self.assertEqual(state['history'], [])
        for _ in range(3):
            self.assertEqual(len(self.engine.snapshot(self.tokens[0])['decisions']), 1)
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision['id']})

    def test_fixed_vote_requires_canonical_option_and_every_explicit_ballot(self):
        decision = self.fixed_decision()
        for option in ('approve', 'invented', None):
            with self.assertRaises(RuleError):
                self.command('vote_option', {'decision_id': decision, 'option_id': option})
        with self.assertRaises(RuleError):
            self.command('vote_decision', {'decision_id': decision, 'choice': 'approve'})
        self.command('vote_option', {'decision_id': decision, 'option_id': 'wait_for_director',
                                    'member': self.ids[2]}, 0)
        state = self.engine.snapshot(self.tokens[0])
        self.assertEqual(state['decisions'][0]['voted_members'], [self.ids[0]])
        self.assertEqual(state['decisions'][0]['ballot_count'], 1)
        self.assertNotIn('votes', state['decisions'][0])
        self.assertEqual(state['decisions'][0]['my_vote'], 'wait_for_director')
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision})
        self.option_ballots(decision, ['controlled_continuity', 'controlled_continuity', 'technical_first'])
        state = self.engine.snapshot(self.tokens[0])
        self.assertEqual(state['decisions'][0]['tally']['controlled_continuity'], 2)
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision}, 1)
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision, 'option_id': 'technical_first'})
        state['decisions'][0]['options'][0]['proposal'] = 'Tampered snapshot'
        result = self.command('commit_decision', {'decision_id': decision, 'proposal': 'Client override'})
        committed = result['history'][0]
        self.assertEqual(committed['option_id'], 'controlled_continuity')
        self.assertEqual(committed['proposal'], DECISION['options'][0]['proposal'])
        self.assertEqual(committed['status'], 'approved')
        self.assertEqual(committed['reason'], 'plurality')
        self.assertEqual(committed['tally'], {'controlled_continuity': 2, 'technical_first': 1, 'wait_for_director': 0})
        with self.assertRaises(RuleError):
            self.command('vote_option', {'decision_id': decision, 'option_id': 'wait_for_director'})
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision})
        self.assertEqual(self.command('end')['phase'], 'ended')
        self.assertEqual(len(self.engine.snapshot(self.tokens[0])['history']), 1)

    def test_each_first_ballot_is_requested_in_order_without_skipping(self):
        decision=self.fixed_decision()
        snapshot=lambda:self.engine.snapshot(self.tokens[0])['decisions'][0]
        self.assertEqual(snapshot()['next_voter'],self.ids[0])
        self.assertEqual(snapshot()['waiting_members'],self.ids)
        for who in (1,2):
            with self.assertRaises(RuleError) as error:
                self.command('vote_option',{'decision_id':decision,'option_id':'controlled_continuity'},who)
            self.assertEqual(error.exception.status,403)
        self.assertEqual(snapshot()['ballot_count'],0)
        self.command('vote_option',{'decision_id':decision,'option_id':'controlled_continuity'})
        self.assertEqual(snapshot()['next_voter'],self.ids[1])
        # An offline participant is still owed their own vote, never skipped or replaced.
        self.command('leave',who=1)
        self.assertEqual(snapshot()['next_voter'],self.ids[1])
        self.command('vote_option',{'decision_id':decision,'option_id':'technical_first'},1)
        self.assertEqual(snapshot()['next_voter'],self.ids[2])
        self.command('vote_option',{'decision_id':decision,'option_id':'technical_first'},0)
        self.assertEqual(snapshot()['next_voter'],self.ids[2])
        self.command('vote_option',{'decision_id':decision,'option_id':'controlled_continuity'},2)
        self.assertIsNone(snapshot()['next_voter'])
        self.assertEqual(snapshot()['waiting_members'],[])

    def test_fixed_ballot_cannot_be_cancelled_or_replaced_with_custom_text(self):
        decision = self.fixed_decision()
        with self.assertRaises(RuleError):
            self.command('cancel_decision', {'decision_id': decision, 'reason': 'Avoid the ballot'})
        with self.assertRaises(RuleError):
            self.command('end')
        source = self.engine.snapshot(self.tokens[0])['transcript'][0]['id']
        with self.assertRaises(RuleError):
            self.command('propose_decision', {'problem': 'New problem', 'proposal': 'Different choice', 'source_ids': [source]})
        self.assertEqual(len(self.engine.snapshot(self.tokens[0])['decisions']), 1)
        self.assertEqual(self.engine.snapshot(self.tokens[0])['history'], [])

    def test_fixed_ties_require_ceo_choice_among_leaders(self):
        fourth = self.engine.join('Devon', self.code)
        self.tokens.append(fourth['token'])
        self.ids.append(self.engine.snapshot(fourth['token'])['me'])
        decision = self.fixed_decision()
        self.option_ballots(decision, ['controlled_continuity', 'technical_first', 'technical_first', 'controlled_continuity'])
        for selection in (None, 'wait_for_director', 'invented'):
            with self.assertRaises(RuleError):
                self.command('commit_decision', {'decision_id': decision, 'option_id': selection})
        with self.assertRaises(RuleError):
            self.command('commit_decision', {'decision_id': decision, 'option_id': 'technical_first'}, 1)
        state = self.command('commit_decision', {'decision_id': decision, 'option_id': 'technical_first'})
        self.assertEqual(state['history'][0]['option_id'], 'technical_first')
        self.assertEqual(state['history'][0]['reason'], 'ceo_tie_break')
        self.assertEqual(state['history'][0]['proposal'], DECISION['options'][1]['proposal'])

    def test_mixed_documents_do_not_activate_t01_ballot(self):
        self.engine.set_documents(self.code, ['T01', 'other-upload'], True)
        self.discussion()
        self.command('finish_discussion')
        state = self.command('skip_consultation')
        self.assertIsNone(state['fixed_scenario'])
        self.assertEqual(state['decisions'], [])

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
        self.assertEqual(self.command('start')['phase'], 'preparation')

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
        self.assertEqual(self.command('start', who=1)['phase'], 'preparation')
        with self.assertRaises(RuleError):
            self.command('finish_discussion', who=1)
        self.now += 30
        self.assertEqual(self.engine.snapshot(self.tokens[1])['phase'], 'discussion')
        with self.assertRaises(RuleError):
            self.command('finish_discussion')
        self.assertEqual(self.command('finish_discussion', who=1)['phase'], 'consultation')
        with self.assertRaises(RuleError):
            self.command('skip_consultation')
        self.assertEqual(self.command('skip_consultation', who=1)['phase'], 'decision')
        with self.assertRaises(RuleError):
            self.command('assign_roles', {'roles': roles})

    def test_clock_catches_up_exact_deadlines(self):
        state = self.start()
        self.assertEqual(state['deadline'], 1030)
        self.assertIsNone(state['speaker'])
        self.now = 1029.9
        self.assertEqual(self.engine.snapshot(self.tokens[1])['phase'], 'preparation')
        self.now = 1030
        state = self.engine.snapshot(self.tokens[1])
        self.assertEqual(state['phase'], 'discussion')
        self.assertEqual(state['deadline'], 1330)
        self.assertEqual(state['speaker'], self.ids[0])
        self.now = 1329.9
        self.assertEqual(self.engine.snapshot(self.tokens[1])['phase'], 'discussion')
        self.now = 1330
        state = self.engine.snapshot(self.tokens[1])
        self.assertEqual(state['phase'], 'consultation')
        self.assertEqual(state['deadline'], 1390)
        self.assertIsNone(state['speaker'])
        self.now = 1389.9
        self.assertEqual(self.engine.snapshot(self.tokens[1])['phase'], 'consultation')
        self.now = 1390
        state = self.engine.snapshot(self.tokens[1])
        self.assertEqual(state['phase'], 'decision')
        self.assertIsNone(state['deadline'])
        events = self.engine.rooms[self.code]['events']
        self.assertEqual([event['at'] for event in events if event['type'] == 'phase'], [1000, 1030, 1330, 1390])

    def test_long_poll_gap_does_not_extend_the_five_minute_round(self):
        self.start()
        self.now = 2000
        state = self.engine.snapshot(self.tokens[0])
        self.assertEqual(state['phase'], 'decision')
        events = self.engine.rooms[self.code]['events']
        self.assertEqual([event['at'] for event in events if event['type'] == 'phase'], [1000, 1030, 1330, 1390])

    def test_only_ceo_can_finish_discussion_early(self):
        state = self.discussion()
        self.assertEqual(state['deadline'], 1330)
        self.now += 9
        with self.assertRaises(RuleError):
            self.command('finish_discussion', who=1)
        state = self.command('finish_discussion')
        self.assertEqual(state['phase'], 'consultation')
        self.assertEqual(state['deadline'], 1099)
        with self.assertRaises(RuleError):
            self.command('skip_consultation', who=1)
        state = self.command('skip_consultation')
        self.assertEqual(state['phase'], 'decision')
        self.assertIsNone(state['deadline'])
        with self.assertRaises(RuleError):
            self.command('skip_facilitator')

    def test_only_speaker_can_contribute_and_turns_cycle(self):
        state = self.discussion()
        self.assertEqual(state['speaking'], self.ids)
        self.assertEqual(state['turn_number'], 1)
        self.assertTrue(state['members'][0]['speaking'])
        self.assertFalse(state['members'][1]['speaking'])
        with self.assertRaises(RuleError):
            self.command('contribute', {'text': 'Out of turn'}, 1)
        with self.assertRaises(RuleError):
            self.command('next_turn', who=2)
        self.command('contribute', {'text': 'CEO speaks first'})
        state = self.command('next_turn', {'turn_number': 1})
        self.assertEqual(state['speaker'], self.ids[1])
        self.command('contribute', {'text': 'Blair speaks next'}, 1)
        with self.assertRaises(RuleError):
            self.command('contribute', {'text': 'Even CEO must wait'})
        state = self.command('next_turn', who=1)
        self.assertEqual(state['speaker'], self.ids[2])
        state = self.command('next_turn')
        self.assertEqual(state['speaker'], self.ids[0])
        self.assertEqual(state['turn_number'], 4)
        with self.assertRaises(RuleError):
            self.command('next_turn', {'turn_number': 1})

    def test_audio_expires_and_cannot_survive_turn_or_phase_changes(self):
        self.discussion()
        room = self.engine.rooms[self.code]
        def lease():
            audio = {'id': uuid.uuid4().hex, 'member': room['speaker'], 'phase': 'discussion',
                     'turn_number': room['turn_number'], 'status': 'playing', 'expires': self.now + 10,
                     'path': '/private/file.mp3', 'token': 'private-service-token'}
            room['active_audio'] = audio
            return audio
        first = lease()
        public = self.engine.snapshot(self.tokens[0])['active_audio']
        self.assertNotIn('path', public)
        self.assertNotIn('token', public)
        self.command('next_turn')
        self.assertIsNone(room['active_audio'])
        self.assertEqual(first['status'], 'cancelled')
        second = lease()
        self.now += 10
        self.assertIsNone(self.engine.snapshot(self.tokens[1])['active_audio'])
        self.assertEqual(second['status'], 'cancelled')
        third = lease()
        self.command('finish_discussion')
        self.assertIsNone(room['active_audio'])
        self.assertEqual(third['status'], 'cancelled')

    def test_recorded_caption_requires_trusted_helper_and_current_turn(self):
        self.discussion()
        with self.assertRaises(RuleError):
            self.command('contribute', {'text': 'Forged caption', 'source': 'recorded'})
        with self.assertRaises(RuleError):
            self.command('contribute_recorded', {'text': 'Forged caption', 'recording_id': 'clip-1'})
        state = self.engine.contribute_recorded(self.tokens[0], 'Caption from catalog', 'clip-1',
                                                'trusted-recording', turn_number=1)
        entry = state['transcript'][0]
        self.assertEqual(entry['source'], 'recorded')
        self.assertEqual(entry['recording_id'], 'clip-1')
        self.assertEqual(entry['turn_number'], 1)
        self.engine.contribute_recorded(self.tokens[0], 'Caption from catalog', 'clip-1',
                                        'trusted-recording', turn_number=1)
        self.assertEqual(len(self.engine.rooms[self.code]['transcript']), 1)
        self.command('next_turn')
        self.command('next_turn', who=1)
        self.command('next_turn', who=2)
        with self.assertRaises(RuleError):
            self.engine.contribute_recorded(self.tokens[0], 'Late caption', 'clip-1',
                                            'late-recording', turn_number=1)

    def test_transcript_reviewed_sources_and_document_freeze(self):
        self.start()
        with self.assertRaises(RuleError):
            self.command('contribute', {'text': 'too early'})
        with self.assertRaises(RuleError):
            self.engine.set_documents(self.code, ['different'], True)
        with self.assertRaises(RuleError):
            self.engine.join('Late', self.code)
        self.now += 30
        self.command('next_turn')
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
        self.command('next_turn')
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
        self.assertEqual(self.command('start')['phase'], 'preparation')


if __name__ == '__main__':
    unittest.main()
