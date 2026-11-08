"""Test navigation must preserve work, authority and missing score boundaries."""
import json
import unittest
import uuid
from playtest.tests import test_four_rounds as fixtures

class SkipTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.FourRoundTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
    def skip(self,stage,who=0,**extra):
        state=self.f.state(who)
        return self.f.call('command/skip_test_stage',{'command_id':uuid.uuid4().hex,
            'expected_phase':state['phase'],'skip_revision':state['test_skip']['revision'],'stage':stage,**extra},who)
    def start(self):
        for who in range(3):self.f.cmd('ready',who,ready=True)
        self.f.cmd('start')
    def test_opening_and_every_round_skip_without_fabricated_work_or_winner(self):
        self.start()
        self.assertEqual(self.skip('opening').status_code,200)
        self.assertEqual(self.f.state()['phase'],'discussion')
        self.assertFalse(self.f.state()['test_skip']['ranking_disabled'])
        self.assertEqual(self.skip('round1').status_code,200)
        self.assertEqual(self.f.state()['phase'],'private')
        for who in range(3):
            ps=self.f.state(who)['private_session'];self.assertEqual(ps['answers'],{});self.assertIsNone(ps['card'])
        self.assertTrue(all(d['skipped'] for d in self.f.room['individual_decisions'].values()))
        self.assertEqual(self.skip('coaching').status_code,200)
        self.f.agent();ps=self.f.state()['private_session']
        self.assertIn('Preparation was skipped',ps['prompt']);self.assertIsNone(ps['card']);self.assertEqual(ps['scores'],{})
        self.assertEqual(self.skip('assessment').status_code,200)
        self.assertEqual(self.f.state()['phase'],'reunion')
        prompts=len(self.f.provider.prompts)
        summary=self.f.service.reunion(self.f.seats[0]['token'],uuid.uuid4().hex)
        self.assertIn('Missing answers were not graded',summary['text'])
        self.assertEqual(len(self.f.provider.prompts),prompts)
        self.assertEqual(self.f.call('command/announce_winner',{'command_id':uuid.uuid4().hex}).status_code,409)
        r=self.f.call('exercise/review',{'command_id':uuid.uuid4().hex,'review_stage':1,'quote':'never submitted'})
        self.assertEqual(r.status_code,409,r.text)
        self.assertEqual(self.skip('reunion').status_code,200)
        self.assertEqual(self.f.state()['phase'],'ended');self.assertEqual(self.f.room['winners'],[])
        self.assertTrue(all(not s['scores'] and not s['answers'] for s in self.f.room['private_sessions'].values()))
    def test_ceo_only_stale_revision_and_idempotent_skip(self):
        self.start();self.assertEqual(self.skip('opening',1).status_code,403)
        data={'command_id':uuid.uuid4().hex,'stage':'opening','expected_phase':'preparation','skip_revision':0}
        self.assertEqual(self.f.call('command/skip_test_stage',data).status_code,200)
        self.assertEqual(self.f.call('command/skip_test_stage',data).status_code,200)
        self.assertEqual(len(self.f.room['test_skips']),1)
        self.assertEqual(self.skip('round1',skip_revision=0).status_code,409)
        self.assertEqual(self.skip('assessment').status_code,409)
    def test_busy_agent_and_live_lock_block_skip_without_partial_mutation(self):
        self.f.begin();ps=self.f.room['private_sessions'][self.f.state()['me']];ps['busy']=True
        before=json.dumps(self.f.room,sort_keys=True)
        self.assertEqual(self.skip('coaching').status_code,409)
        self.assertEqual(json.dumps(self.f.room,sort_keys=True),before)
        ps['busy']=False;self.assertEqual(self.skip('coaching').status_code,200)
    def test_skip_preserves_submitted_answers_and_earned_points(self):
        self.f.begin();self.f.complete_member(0)
        own=self.f.state()['private_session'];self.assertEqual(own['total'],70)
        self.assertEqual(self.skip('coaching').status_code,200)
        self.assertEqual(self.f.state()['private_session']['answers'],own['answers'])
        self.assertEqual(self.skip('assessment').status_code,200)
        self.assertEqual(self.f.state()['private_session']['total'],70)
        self.assertFalse(self.f.state()['private_session'].get('assessment_skipped',False))
        self.assertTrue(self.f.state(1)['private_session']['assessment_skipped'])
        self.assertEqual(self.f.state(1)['private_session']['answers'],{})
