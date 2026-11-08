"""Section navigation must never bypass decisions or reviewed assessment work."""
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
    def test_sections_end_early_but_experts_and_decisions_stay_required(self):
        self.start();self.assertEqual(self.skip('opening').status_code,200)
        self.assertEqual(self.f.state()['phase'],'discussion')
        self.assertEqual(self.skip('discussion').status_code,200)
        self.assertEqual(self.f.state()['phase'],'consultation')
        self.assertEqual(self.skip('consultation').status_code,409)
        self.assertEqual(self.f.room['individual_decisions'],{})
        for kind in ('it','operations','governance'):self.f.engine.record_expert(self.f.room,kind,'Public perspective',[],kind,[])
        self.assertEqual(self.skip('consultation').status_code,200)
        self.assertEqual(self.f.state()['phase'],'decision')
        self.assertEqual(self.f.call('command/end',{'command_id':uuid.uuid4().hex}).status_code,409)
        self.assertEqual(self.f.room['individual_decisions'],{})
        self.assertFalse(self.f.state()['test_skip']['ranking_disabled'])
    def test_whole_round_bypasses_rejected_including_direct_api_calls(self):
        self.start()
        for stage in ('round1','coaching','assessment','reunion'):
            self.assertEqual(self.skip(stage).status_code,409)
        self.assertNotIn('private_sessions',self.f.room)
        self.assertEqual(self.f.room['individual_decisions'],{})
        self.assertNotIn('test_skips',self.f.room)
    def test_ceo_only_stale_revision_and_idempotent_section_skip(self):
        self.start();self.assertEqual(self.skip('opening',1).status_code,403)
        data={'command_id':uuid.uuid4().hex,'stage':'opening','expected_phase':'preparation','skip_revision':0}
        self.assertEqual(self.f.call('command/skip_test_stage',data).status_code,200)
        self.assertEqual(self.f.call('command/skip_test_stage',data).status_code,200)
        self.assertEqual(len(self.f.room['test_skips']),1)
        self.assertEqual(self.skip('discussion',skip_revision=0).status_code,409)
    def test_private_questions_cards_assessment_and_reunion_have_no_skip(self):
        self.f.begin()
        self.assertEqual(self.f.state()['test_skip']['actions'],[])
        self.assertEqual(self.skip('coaching').status_code,409)
        for who in range(3):self.f.complete_member(who)
        self.assertEqual(self.f.state()['phase'],'reunion')
        self.assertEqual(self.skip('reunion').status_code,409)
        self.assertEqual(self.f.state()['test_skip']['actions'],[])
        self.assertEqual(self.f.call('command/announce_winner',{'command_id':uuid.uuid4().hex}).status_code,409)
        self.assertTrue(all(len(s['answers'])==6 and len(s['scores'])==3 for s in self.f.room['private_sessions'].values()))
