"""Real fixture bytes, authority, privacy and complete four round flow; fake inference."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import threading
import unittest
import uuid
from fastapi.testclient import TestClient
from playtest.engine import RuleError
from playtest.four_rounds import CARD_FIELDS, COACH_QUESTIONS, EXAM_QUESTIONS
from playtest.roundtable import Roundtable
from playtest.server import create_app
from playtest.tests.test_roundtable_api import MemoryFixture
from playtest.tests.test_preparation_stream import StreamingSpeech


class ExerciseProvider:
    def __init__(self):self.prompts=[];self.temperatures=[];self.invalid=None;self.barrier=None
    def run(self,prompt,model='text',temperature=None,**kwargs):
        self.prompts.append(prompt);self.temperatures.append(temperature)
        data=json.loads(prompt.split('\n',1)[1])
        if self.barrier and data.get('phase')=='coaching' and data.get('turn')==1:self.barrier.wait(5)
        if self.invalid=='failure':raise RuntimeError('Synthetic provider failure')
        if 'criteria' in data:
            points=8 if data.get('overlooked_quote_from_same_answer') else 7
            obj={'criteria':[{'id':key,'points':11 if self.invalid=='points' else points,
                'evidence':'invented evidence' if self.invalid=='evidence' else data['answer'][:80],
                'reason':'The quoted response supports this criterion, with room for a clearer review arrangement.'} for key in data['criteria']]}
        elif 'branches' in data:
            obj={'members':[{'member':b['member'],'adaptation':'Adapted the response to delayed technical support.',
                'strength':'Preserved uncertainty.','improvement':'Specify the review time.'} for b in data['branches']]}
        elif 'draft card' in prompt:
            obj={'card':{field:'Review '+field+' using my own plan.' for field in CARD_FIELDS}}
        else:
            obj={'acknowledgement':'You have identified a dependency to check.','question':'Who can authorize the action in your own plan?'}
        return {'text':json.dumps(obj)}


class FourRoundTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.now=1000.;self.engine=Roundtable(clock=lambda:self.now)
        memory=MemoryFixture(self.temp.name);memory.documents[0]['id']='T01';old=memory.status;memory.status=lambda:{**old(),'demo_document_ids':['T01']}
        self.provider=ExerciseProvider();self.speech=StreamingSpeech()
        self.app=create_app(roundtable=self.engine,memory=memory,provider=self.provider,speech=self.speech)
        self.client=TestClient(self.app).__enter__();self.addCleanup(lambda:self.client.__exit__(None,None,None))
        self.service=self.app.state.roundtable_service.exercise
        self.seats=[self.client.post('/api/roundtable/join',json={'name':'A','flow':'four_rounds'}).json()]
        for name in ('B','C'):self.seats.append(self.client.post('/api/roundtable/join',json={'name':name,'code':self.seats[0]['code']}).json())
        self.room=self.engine.rooms[self.seats[0]['code']]
    def headers(self,who=0):return {'Authorization':'Bearer '+self.seats[who]['token']}
    def call(self,path,data=None,who=0):
        return self.client.get('/api/roundtable/'+path,headers=self.headers(who)) if data is None else self.client.post('/api/roundtable/'+path,headers=self.headers(who),json=data)
    def cmd(self,name,who=0,**data):
        r=self.call('command/'+name,{'command_id':uuid.uuid4().hex,**data},who);self.assertEqual(r.status_code,200,r.text);return r.json()
    def state(self,who=0):return self.engine.snapshot(self.seats[who]['token'])
    def begin(self,beta=True):
        self.cmd('set_beta_mode',enabled=beta)
        for who in range(3):self.cmd('ready',who,ready=True)
        self.cmd('start');self.now+=30;self.cmd('finish_discussion')
        for kind in ('it','operations','governance'):self.engine.record_expert(self.room,kind,'Shared public advice',[],kind,[])
        self.cmd('skip_consultation')
        for who in range(3):
            fields=self.fixture(who)['response_fields']
            fields['action']='PRIVATE_ORIGIN_'+str(who)+' '+fields['action']
            self.cmd('submit_individual_decision',who,revision=0,**fields)
        self.cmd('end');self.assertEqual(self.room['phase'],'private')
    def fixture(self,who=0,index=0):
        catalog=self.call('exercise/recordings',who=who);self.assertEqual(catalog.status_code,200,catalog.text)
        clip=catalog.json()['clips'][index]
        response=self.call('exercise/recordings/play',{'clip_id':clip['id']},who);self.assertEqual(response.status_code,200,response.text);lease=response.json()
        self.assertEqual(self.call('exercise/recordings/complete',{'id':lease['id']},who).status_code,409)
        self.assertEqual(self.call('exercise/recordings/audio/'+lease['id'],who=(who+1)%3).status_code,409)
        audio=self.call('exercise/recordings/audio/'+lease['id'],who=who);self.assertEqual(audio.status_code,200);self.assertTrue(audio.content)
        self.now+=lease['duration_seconds']+.1
        done=self.call('exercise/recordings/complete',{'id':lease['id']},who);self.assertEqual(done.status_code,200,done.text)
        return done.json()
    def agent(self,who=0):return self.service.prepare(self.seats[who]['token'],uuid.uuid4().hex)
    def answer(self,who=0):
        sample=self.fixture(who);ps=self.state(who)['private_session']
        self.cmd('private_answer',who,text=sample['text'],revision=ps['revision'],recording_lease=sample['lease_id'])
    def complete_member(self,who=0):
        for _ in range(3):self.agent(who);self.answer(who)
        self.agent(who);ps=self.state(who)['private_session'];self.assertEqual(ps['scores'],{})
        self.cmd('confirm_response_card',who,revision=ps['revision'],**ps['card'])
        for stage in range(1,4):
            self.agent(who);self.answer(who);self.agent(who)
            state=self.state(who);self.assertEqual(state['private_session']['total'],[21,49,70][stage-1])
            if stage<3:self.assertNotIn('criteria',state['private_session']['scores'][str(stage)])
    def test_all_rounds_all_new_recordings_scoring_reunion_review_and_winner(self):
        self.begin()
        for who in range(3):self.complete_member(who)
        self.assertEqual(self.room['phase'],'reunion')
        self.assertEqual(self.call('command/announce_winner',{'command_id':uuid.uuid4().hex}).status_code,409)
        self.service.reunion(self.seats[0]['token'],uuid.uuid4().hex)
        before=self.state()['reunion']['branches'][0]['total']
        for who in range(3):
            for index in range(2):
                clip=self.fixture(who,index);self.cmd('reunion_contribute',who,text=clip['text'],recording_lease=clip['lease_id'])
        self.assertEqual(self.state()['reunion']['branches'][0]['total'],before)
        answer=self.room['private_sessions'][self.state()['me']]['answers']['assessment_1']['text']
        self.assertEqual(self.call('exercise/review',{'review_stage':1,'quote':'A brand new argument'}).status_code,422)
        r=self.call('exercise/review',{'review_stage':1,'quote':answer[:40]});self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.state()['private_session']['total'],73)
        self.assertIsNone(self.state()['reunion']['summary'])
        self.service.reunion(self.seats[0]['token'],uuid.uuid4().hex)
        for who in range(3):self.cmd('confirm_score_review',who)
        self.cmd('announce_winner');self.assertEqual(self.room['phase'],'ended');self.assertEqual(self.room['winners'],[self.state()['me']])
        self.assertEqual(len(self.room['reunion_discussion']),6)
    def test_private_contexts_are_isolated_and_three_agents_can_run_concurrently(self):
        self.begin();self.provider.barrier=threading.Barrier(3)
        with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(self.agent,range(3)))
        self.assertEqual(len({r['agent_id'] for r in results}),3)
        self.assertTrue(all(COACH_QUESTIONS[0] in r['text'] for r in results));self.assertTrue(all(t==0 for t in self.provider.temperatures))
        for prompt in self.provider.prompts:
            self.assertEqual(sum('PRIVATE_ORIGIN_'+str(who) in prompt for who in range(3)),1)
        self.answer(0)
        other=json.dumps(self.state(1));self.assertNotIn('PRIVATE_ORIGIN_0',other);self.assertNotIn('I would keep coordination separate',other)
        ps=self.state(1)['private_session'];r=self.call('command/private_answer',{'command_id':uuid.uuid4().hex,'revision':ps['revision'],'text':'Wrong target','member':self.state()['me']},1);self.assertEqual(r.status_code,422)
    def test_adaptive_mode_and_scoring_reject_invalid_output_without_losing_answer(self):
        self.begin(beta=False);first=self.agent();self.assertIn('Who can authorize',first['text']);self.assertNotIn(COACH_QUESTIONS[0],first['text']);self.assertIn('IT specialist is now unavailable',first['text'])
        self.assertIn(.3,self.provider.temperatures)
        for _ in range(3):
            self.answer();self.agent()
        ps=self.state()['private_session'];self.cmd('confirm_response_card',revision=ps['revision'],**ps['card']);self.agent();self.answer()
        for invalid in ('points','evidence','failure'):
            self.provider.invalid=invalid
            with self.assertRaises(Exception):self.agent()
            ps=self.state()['private_session'];self.assertEqual(ps['phase'],'grading');self.assertEqual(ps['scores'],{});self.assertTrue(ps['answers']['assessment_1']['text'])
        self.provider.invalid=None;self.agent();self.assertEqual(self.state()['private_session']['total'],21)
    def test_fixed_questions_idempotency_stale_revision_and_agent_identity(self):
        self.begin();token=self.seats[0]['token'];cid=uuid.uuid4().hex
        first=self.service.prepare(token,cid);count=len(self.provider.prompts);again=self.service.prepare(token,cid)
        self.assertTrue(again['replayed']);self.assertEqual(count,len(self.provider.prompts));self.assertEqual(first['agent_id'],again['agent_id'])
        old=self.state()['private_session']['revision'];self.answer()
        self.assertEqual(self.call('command/private_answer',{'command_id':uuid.uuid4().hex,'revision':old,'text':'stale'}).status_code,409)
        next=self.agent();self.assertIn(COACH_QUESTIONS[1],next['text']);self.assertEqual(first['agent_id'],next['agent_id'])
        self.assertEqual(self.call('exercise/recordings/play',{'clip_id':'r3_member_1_step_1'}).status_code,403)
        self.assertEqual(self.call('command/set_beta_mode',{'command_id':uuid.uuid4().hex,'enabled':False}).status_code,403)

    def test_private_voice_stream_and_speech_failure_preserve_written_prompt(self):
        self.begin()
        response=self.call('exercise/agent',{'command_id':uuid.uuid4().hex,'voice':True})
        self.assertEqual(response.status_code,200,response.text)
        events=[json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(events[0]['type'],'text');self.assertTrue(any(e['type']=='audio' for e in events))
        self.speech.fail=True
        response=self.call('exercise/agent',{'command_id':uuid.uuid4().hex,'voice':True})
        events=[json.loads(line) for line in response.text.splitlines()]
        self.assertTrue(any(e['type']=='speech_error' for e in events))
        self.assertEqual(events[0]['text'],self.state()['private_session']['prompt'])
        self.assertNotIn('Sensitive upstream',response.text)

    def test_failed_review_retains_score_and_requires_retry_or_withdrawal(self):
        self.begin()
        for who in range(3):self.complete_member(who)
        answer=self.state()['private_session']['answers']['assessment_1']['text']
        self.provider.invalid='failure'
        r=self.call('exercise/review',{'review_stage':1,'quote':answer[:40]});self.assertEqual(r.status_code,502)
        self.assertEqual(self.state()['private_session']['total'],70)
        self.assertEqual(self.call('command/confirm_score_review',{'command_id':uuid.uuid4().hex}).status_code,409)
        self.cmd('withdraw_score_review',review_stage=1);self.provider.invalid=None
        self.service.reunion(self.seats[0]['token'],uuid.uuid4().hex)
        for who in range(3):self.cmd('confirm_score_review',who)
        self.cmd('announce_winner');self.assertEqual(len(self.room['winners']),3)
