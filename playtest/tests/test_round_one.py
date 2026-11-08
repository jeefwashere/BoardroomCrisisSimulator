"""Round 1 authority and complete HTTP integration without paid providers."""
import json
from pathlib import Path
import tempfile
import unittest
import uuid
from fastapi.testclient import TestClient
from playtest.server import create_app
from playtest.roundtable import Roundtable
from playtest.engine import RuleError
from playtest.tests.test_roundtable_api import MemoryFixture
from playtest.tests.test_preparation_stream import StreamingProvider, StreamingSpeech


class RoundOneTests(unittest.TestCase):
    def setUp(self):
        self.now=1000
        self.engine=Roundtable(clock=lambda:self.now)
        self.seats=[self.engine.join('CEO',flow='board_round1')]
        self.code=self.seats[0]['code']
        self.seats += [self.engine.join(n,self.code) for n in ('B','C')]
        self.engine.set_documents(self.code,['T01'],True)
        self.room=self.engine.rooms[self.code]
    def command(self,action,who=0,**data):
        return self.engine.command(self.seats[who]['token'],action,{'command_id':uuid.uuid4().hex,**data})
    def experts(self):
        for who in range(3):self.command('ready',who,ready=True)
        self.command('start');self.now+=30
        self.command('contribute',text='Check backups and keep appointments available.')
        self.command('finish_discussion')
    def decisions(self):
        self.experts()
        for kind in ('it','operations','governance'):self.engine.record_expert(self.room,kind,'Evidence bounded perspective',[],kind,[])
        self.command('skip_consultation')
    def submit(self,who=0,**extra):
        payload={'action':'Unique action '+str(who),'reasoning':'My reasoning','evidence':'Public report','unknowns':'Backup usability remains unknown','revision':0,**extra}
        return self.engine.command(self.seats[who]['token'],'submit_individual_decision',{'command_id':uuid.uuid4().hex,**payload})
    def test_preparation_preserved_and_expert_stage_cannot_be_skipped_or_timed_out(self):
        self.experts();self.assertEqual(self.room['phase'],'consultation');self.assertIsNone(self.room['deadline'])
        self.now+=10000;self.engine.tick(self.room);self.assertEqual(self.room['phase'],'consultation')
        with self.assertRaises(RuleError):self.command('skip_consultation')
        with self.assertRaises(RuleError):self.submit()
        for kind in ('it','operations','governance'):self.engine.record_expert(self.room,kind,'Expert text',[],kind,[])
        state=self.command('skip_consultation');self.assertEqual(state['decisions'],[]);self.assertEqual(state['scoring'],'none')
    def test_own_decision_isolation_revision_and_frozen_context(self):
        self.decisions()
        with self.assertRaises(RuleError):self.command('end')
        with self.assertRaises(RuleError):self.submit(0,member=self.room['electorate'][1])
        with self.assertRaises(RuleError):self.submit(0,points=100)
        a=self.submit(0);b=self.engine.snapshot(self.seats[1]['token'])
        self.assertEqual(a['individual_decision']['action'],'Unique action 0');self.assertIsNone(b['individual_decision'])
        self.assertNotIn('Unique action 0',json.dumps(b))
        with self.assertRaises(RuleError):self.submit(0)
        self.submit(0,revision=1,reasoning='Revised own reasoning')
        for who in (1,2):self.submit(who)
        with self.assertRaises(RuleError):self.command('end',1)
        self.command('end')
        context=self.engine.round_one_context(self.seats[1]['token']);self.assertEqual(context['individual_decision']['action'],'Unique action 1')
        self.assertNotIn('Unique action 0',json.dumps(context));self.assertIsNone(context['score'])
        context['individual_decision']['action']='tamper';self.assertEqual(self.engine.round_one_context(self.seats[1]['token'])['individual_decision']['action'],'Unique action 1')
        with self.assertRaises(RuleError):self.submit(1,revision=1)
    def test_bounds_idempotency_and_no_legacy_votes(self):
        self.decisions()
        for field in ('action','reasoning','evidence','unknowns'):
            with self.assertRaises(RuleError):self.submit(**{field:''})
            with self.assertRaises(RuleError):self.submit(**{field:'x'*1201})
        with self.assertRaises(RuleError):self.submit(revision=True)
        for action in ('vote_option','commit_decision','add_custom_option','propose_decision'):
            with self.assertRaises(RuleError):self.command(action)
        data={'command_id':uuid.uuid4().hex,'action':'Act','reasoning':'Reasons','evidence':'Report','unknowns':'Unknowns','revision':0}
        first=self.engine.command(self.seats[0]['token'],'submit_individual_decision',data)
        again=self.engine.command(self.seats[0]['token'],'submit_individual_decision',data)
        self.assertEqual(first,again)

    def test_http_preparation_experts_individual_submissions_and_context(self):
        now=[1000.0];speech=StreamingSpeech();provider=StreamingProvider(speech)
        with tempfile.TemporaryDirectory() as tmp:
            memory=MemoryFixture(tmp)
            original_search=memory.search
            memory.search=lambda *args,**kwargs:original_search(*args,**kwargs)+[{'id':'old_rules','document_id':'T01','title':'Old instructions','page':2,'text':'Shared participant instructions OLD_THRESHOLD_SECRET'}]
            app=create_app(memory=memory,speech=speech,provider=provider,roundtable=Roundtable(clock=lambda:now[0]))
            with TestClient(app) as client:
                seats=[client.post('/api/roundtable/join',json={'name':'CEO','flow':'board_round1'}).json()]
                for name in ('B','C'):seats.append(client.post('/api/roundtable/join',json={'name':name,'code':seats[0]['code']}).json())
                def call(path,data=None,who=0):
                    headers={'Authorization':'Bearer '+seats[who]['token']}
                    return client.get('/api/roundtable/'+path,headers=headers) if data is None else client.post('/api/roundtable/'+path,headers=headers,json={'command_id':uuid.uuid4().hex,**data})
                def cmd(name,who=0,**data):
                    r=call('command/'+name,data,who);self.assertEqual(r.status_code,200,r.text);return r.json()
                def stream(kind):
                    r=call('briefing',{'kind':kind,'voice':False});self.assertEqual(r.status_code,200,r.text);self.assertEqual(json.loads(r.text.splitlines()[-1])['status'],'done')
                for who in range(3):cmd('ready',who,ready=True)
                cmd('start');stream('preparation');now[0]+=30
                cmd('contribute',text='Keep community appointments available while verifying backups.')
                clips=call('recordings').json()['default_clip_ids'];self.assertEqual(clips[-2:],['r1_dialogue_08','r1_dialogue_09'])
                for turn,clip in enumerate(clips):
                    who=turn%3
                    lease=call('recordings/play',{'clip_id':clip},who).json()
                    self.assertEqual(call('recordings/audio/'+lease['id'],who=who).status_code,200)
                    now[0]+=lease['duration_seconds']+.1
                    self.assertEqual(call('recordings/complete',{'id':lease['id']},who).status_code,200)
                cmd('finish_discussion');self.assertEqual(call('command/skip_consultation',{}).status_code,409)
                original_stream=provider.stream
                def failing_stream(*args,**kwargs):
                    raise RuntimeError('Synthetic provider failure')
                    yield ''
                provider.stream=failing_stream
                failed=call('briefing',{'kind':'it','voice':False})
                self.assertEqual(json.loads(failed.text.splitlines()[-1])['status'],'failed')
                self.assertNotIn('it',call('state').json()['expert_briefings'])
                provider.stream=original_stream
                for kind in ('it','operations','governance'):
                    stream(kind);self.assertIn('community appointments',provider.prompts[-1]);self.assertIn('No votes, winners, points',provider.prompts[-1]);self.assertIn('do not prescribe vote thresholds',provider.prompts[-1]);self.assertNotIn('controlled_continuity',provider.prompts[-1]);self.assertNotIn('OLD_THRESHOLD_SECRET',provider.prompts[-1])
                state=cmd('skip_consultation');self.assertEqual(len(state['expert_briefings']),3)
                self.assertEqual(call('decision-prompt').status_code,404)
                speech.transcribe=lambda path:{'text':'Provisional decision words'}
                transcript=client.post('/api/roundtable/transcribe',headers={'Authorization':'Bearer '+seats[1]['token'],'X-Command-ID':uuid.uuid4().hex,'Content-Type':'audio/wav'},content=b'fake wav fixture')
                self.assertEqual(transcript.status_code,200)
                self.assertIsNone(call('state',who=1).json()['individual_decision'])
                for who in range(3):
                    cmd('submit_individual_decision',who,action='Action '+str(who),reasoning='Reason',evidence='PDF',unknowns='Recovery time',revision=0)
                cmd('end');r=call('round1-context',who=1).json();self.assertEqual(r['individual_decision']['action'],'Action 1');self.assertEqual(len(r['expert_briefings']),3)
                self.assertNotIn('Action 0',json.dumps(r));self.assertEqual(call('briefing',{'kind':'evaluation','voice':False}).status_code,409)
