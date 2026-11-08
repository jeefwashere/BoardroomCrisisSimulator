"""Solo mode must use one real membership and every required recorded answer."""
import json
import unittest
import uuid
from playtest.tests import test_four_rounds as fixtures

class SoloTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.FourRoundTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
        result=self.f.client.post('/api/roundtable/join',json={'name':'Alex solo','flow':'four_rounds','solo_test':True})
        self.assertEqual(result.status_code,200);self.f.seats=[result.json()]
        self.f.room=self.f.engine.rooms[self.f.seats[0]['code']]
    def begin(self):
        self.f.cmd('ready',ready=True);self.f.cmd('start');self.f.now+=30;self.f.cmd('finish_discussion')
        for kind in ('it','operations','governance'):self.f.engine.record_expert(self.f.room,kind,'Public perspective',[],kind,[])
        self.f.cmd('skip_consultation')
        self.f.cmd('submit_individual_decision',revision=0,action='Appoint interim coordinator',reasoning='Coordinate recovery',evidence='Public plan',unknowns='Backup verification')
        self.f.cmd('end')
    def sequence_answer(self,complete=True,approved=True):
        ps=self.f.state()['private_session'];clip=self.f.service.eligible_clips(self.f.room,self.f.state()['me'])[0]
        ident=uuid.uuid4().hex;self.f.room['private_sessions'][self.f.state()['me']].setdefault('live_history',[]).append({'id':ident,'revision':ps['revision'],'recorded_clips':[clip['id']],'completed_clips':[clip['id']] if complete else []})
        return self.f.call('command/submit_sequence_answer',{'command_id':uuid.uuid4().hex,'revision':ps['revision'],'live_session_id':ident,'approved':approved,'text':'Untrusted override must not replace approved fixture'})
    def test_one_member_start_and_three_owned_discussion_clips(self):
        self.f.cmd('ready',ready=True);self.assertTrue(self.f.state()['can_start']);self.assertTrue(self.f.state()['solo_test'])
        response=self.f.client.post('/api/roundtable/join',json={'name':'Uninvited','code':self.f.seats[0]['code']});self.assertEqual(response.status_code,409)
        clips=self.f.call('recordings').json();self.assertEqual(clips['script_length'],3)
        self.assertEqual([c['turn_number'] for c in clips['clips']],[1,2,3]);self.assertTrue(all(c['default_seat']==0 for c in clips['clips']))
        self.f.cmd('start');self.assertEqual(len(self.f.room['electorate']),1)
    def test_six_recorded_responses_card_gate_and_no_other_members_required(self):
        self.begin();self.assertEqual(len(self.f.room['private_sessions']),1)
        for step in range(1,4):
            self.f.agent();catalog=self.f.call('exercise/sequence').json();self.assertEqual(len(catalog['clips']),4-step)
            expected=catalog['clips'][0]['text'];self.assertEqual(self.sequence_answer().status_code,200)
            self.assertEqual(self.f.state()['private_session']['answers'][f'coaching_{step}']['text'],expected)
        self.assertEqual(self.f.state()['private_session']['phase'],'card_review')
        self.assertEqual(self.f.call('exercise/sequence').status_code,409)
        self.f.agent();ps=self.f.state()['private_session'];self.f.cmd('confirm_response_card',revision=ps['revision'],**ps['card'])
        for step in range(1,4):
            self.f.agent();self.assertEqual(self.sequence_answer().status_code,200);self.f.agent()
        self.assertEqual(self.f.state()['phase'],'reunion');self.assertEqual(self.f.state()['private_session']['total'],70)
        self.assertEqual(self.f.call('command/announce_winner',{'command_id':uuid.uuid4().hex}).status_code,409)
        self.assertEqual(self.f.call('command/finish_solo_test',{'command_id':uuid.uuid4().hex}).status_code,409)
        self.f.service.reunion(self.f.seats[0]['token'],uuid.uuid4().hex);self.f.cmd('confirm_score_review');self.f.cmd('finish_solo_test')
        self.assertEqual(self.f.state()['phase'],'ended');self.assertEqual(self.f.room['winners'],[])
    def test_incomplete_clip_unapproved_submission_and_group_auto_submission_rejected(self):
        self.begin();self.f.agent()
        self.assertEqual(self.sequence_answer(complete=False).status_code,409)
        self.assertEqual(self.sequence_answer(approved=False).status_code,422)
        self.assertEqual(self.f.state()['private_session']['answers'],{})
        self.f.room['solo_test']=False
        self.assertEqual(self.sequence_answer().status_code,403)
