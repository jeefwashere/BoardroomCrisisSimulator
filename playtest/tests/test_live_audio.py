import asyncio
from contextlib import asynccontextmanager
import json
import unittest
import uuid
from starlette.websockets import WebSocketDisconnect
from playtest.tests import test_four_rounds as fixtures

class FakeLive:
    def __init__(self):self.setups=[];self.pcm=[]
    def status(self):return {'configured':True,'model':'fake-live','message':'Test fixture'}
    @asynccontextmanager
    async def connect(self, setup):
        self.setups.append(setup);outer=self
        class Socket:
            def __init__(self):self.queue=asyncio.Queue()
            async def send(self, raw):
                d=json.loads(raw)
                if d.get('clientContent'):
                    await self.queue.put({'serverContent':{'outputTranscription':{'text':'What would you do next?'},'modelTurn':{'parts':[{'inlineData':{'mimeType':'audio/pcm;rate=24000','data':'AAABAA=='}}]},'turnComplete':True}})
                elif d.get('realtimeInput',{}).get('audio'):
                    outer.pcm.append(d['realtimeInput']['audio'])
                    await self.queue.put({'serverContent':{'inputTranscription':{'text':'I would check who can authorize access.'},'interrupted':True}})
            def __aiter__(self):return self
            async def __anext__(self):return json.dumps(await self.queue.get())
        yield Socket(),[]

class LiveTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.FourRoundTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.f.begin();self.f.agent();self.live=FakeLive();self.f.app.state.live_audio.provider=self.live
    def connect(self,who=0,**extra):
        return self.f.client.websocket_connect('/api/roundtable/exercise/live',headers={'origin':'http://testserver',**extra})
    def hello(self,ws,who=0,**extra):
        ps=self.f.state(who)['private_session'];ws.send_json({'token':self.f.seats[who]['token'],'revision':ps['revision'],**extra})
    def until(self,ws,kind):
        events=[]
        for _ in range(12):
            event=ws.receive_json();events.append(event)
            if event['type']==kind:return events
        self.fail('Expected '+kind)
    def test_real_time_pcm_transcripts_interruptions_and_explicit_answer_boundary(self):
        with self.connect() as ws:
            self.hello(ws);self.assertEqual(ws.receive_json()['type'],'ready');self.until(ws,'turn_complete')
            self.assertTrue(self.f.state()['private_session']['busy'])
            r=self.f.call('command/private_answer',{'command_id':uuid.uuid4().hex,'revision':self.f.state()['private_session']['revision'],'text':'early'})
            self.assertEqual(r.status_code,409)
            ws.send_bytes(b'\0\0'*1600);events=self.until(ws,'transcript');self.assertTrue(any(e['type']=='interrupted' for e in events))
            ws.send_json({'type':'stop'});self.until(ws,'closed')
        ps=self.f.state()['private_session'];self.assertFalse(ps['busy']);self.assertEqual(ps['answers'],{});self.assertEqual(ps['scores'],{})
        self.assertTrue(ps['live_history'][0]['provisional']);self.assertEqual(self.live.pcm[0]['mimeType'],'audio/pcm;rate=16000')
        self.assertNotIn('I would check who',json.dumps(self.f.state(1)))
        self.assertEqual(self.live.setups[0]['generationConfig']['temperature'],0)
        self.f.cmd('private_answer',revision=ps['revision'],text='Reviewed answer after stopping')
        self.assertEqual(self.f.state()['private_session']['answers']['coaching_1']['text'],'Reviewed answer after stopping')
    def test_origin_auth_revision_and_untrusted_protocol_controls(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.connect(origin='http://evil.example'):pass
        with self.connect() as ws:
            ws.send_json({'token':'wrong','revision':1});self.assertEqual(ws.receive_json()['type'],'error')
        with self.connect() as ws:
            ws.send_json({'token':self.f.seats[0]['token'],'revision':999});self.assertEqual(ws.receive_json()['type'],'error')
        with self.connect() as ws:
            self.hello(ws);self.until(ws,'turn_complete');ws.send_json({'type':'score','points':100});self.until(ws,'error');self.until(ws,'closed')
        self.assertEqual(self.f.state()['private_session']['scores'],{})
    def test_one_connection_per_member_and_private_context_isolation(self):
        with self.connect() as first:
            self.hello(first);self.until(first,'turn_complete')
            with self.connect() as second:
                self.hello(second);self.assertEqual(second.receive_json()['type'],'error')
            self.assertTrue(self.f.state()['private_session']['busy'])
            first.send_json({'type':'stop'});self.until(first,'closed')
        context=json.dumps(self.live.setups)
        self.assertIn('PRIVATE_ORIGIN_0',context);self.assertNotIn('PRIVATE_ORIGIN_1',context)
    def test_invalid_audio_is_rejected_and_lock_released(self):
        with self.connect() as ws:
            self.hello(ws);self.until(ws,'turn_complete');ws.send_bytes(b'odd');self.until(ws,'error');self.until(ws,'closed')
        self.assertFalse(self.f.state()['private_session']['busy'])
        self.assertEqual(self.live.pcm,[])

    def test_live_assets_and_browser_websocket_policy(self):
        for path in ('/live-audio.js', '/live-capture-worklet.js', '/api/roundtable/exercise/live-status'):
            response=self.f.client.get(path)
            self.assertEqual(response.status_code,200)
            self.assertIn('ws://127.0.0.1:8788',response.headers['content-security-policy'])
        self.assertTrue(self.f.client.get('/api/roundtable/exercise/live-status').json()['configured'])

    def test_dedicated_key_hot_reload_and_no_vertex_key_fallback(self):
        from pathlib import Path
        from unittest.mock import patch
        from playtest.live_audio import LiveProvider
        env=Path(self.f.temp.name)/'live.env'
        with patch.dict('os.environ',{'REHEARSAL_ENV_FILE':str(env),'GOOGLE_API_KEY':'vertex-fixture'},clear=True):
            provider=LiveProvider(None)
            self.assertFalse(provider.status()['configured'])
            env.write_text('GEMINI_API_KEY=developer-fixture\n')
            self.assertEqual(provider.key(),'developer-fixture')
            env.write_text('GEMINI_LIVE_API_KEY=dedicated-fixture\n')
            self.assertEqual(provider.key(),'dedicated-fixture')
            self.assertNotIn('dedicated-fixture',json.dumps(provider.status()))

    def test_recorded_input_streams_current_clip_and_preserves_review_boundary(self):
        pcm=b'\x00\x01'*640;decoded=[]
        async def decode(clip_id):decoded.append(clip_id);return pcm
        self.f.app.state.live_audio.fixture_pcm=decode
        clip=self.f.service.eligible_clips(self.f.room,self.f.state()['me'])[0]
        with self.connect() as ws:
            self.hello(ws,input_mode='recordings');ready=ws.receive_json();self.assertEqual(ready['input_mode'],'recordings')
            self.assertEqual([c['id'] for c in ready['clips']],[clip['id']]);self.until(ws,'turn_complete')
            ws.send_json({'type':'play_fixture','clip_id':clip['id']});events=self.until(ws,'fixture_complete')
            self.assertTrue(any(e['type']=='fixture_audio' and e['sample_rate']==16000 for e in events))
            self.assertTrue(any(e['type']=='transcript' and e['role']=='human' for e in events))
            ws.send_json({'type':'stop'});self.until(ws,'closed')
        self.assertEqual(decoded,[clip['id']]);self.assertEqual(self.f.state()['private_session']['answers'],{})
        saved=self.f.state()['private_session']['live_history'][0]
        self.assertEqual(saved['input_mode'],'recordings');self.assertEqual(saved['recorded_clips'],[clip['id']])
        self.f.cmd('private_answer',revision=self.f.state()['private_session']['revision'],text='Reviewed recognized response',live_session_id=ready['connection_id'])
        self.assertTrue(self.f.state()['private_session']['answers']['coaching_1']['scripted'])
        self.f.agent(1)
        response=self.f.call('command/private_answer',{'command_id':uuid.uuid4().hex,'revision':self.f.state(1)['private_session']['revision'],'text':'Other member','live_session_id':ready['connection_id']},1)
        self.assertEqual(response.status_code,409)

    def test_recorded_connection_rejects_other_member_clip_and_raw_microphone(self):
        wrong=self.f.service.eligible_clips(self.f.room,self.f.state(1)['me'])[0]['id']
        for payload in ({'type':'play_fixture','clip_id':wrong},b'\x00\x00'*640):
            with self.connect() as ws:
                self.hello(ws,input_mode='recordings');self.until(ws,'turn_complete')
                ws.send_bytes(payload) if isinstance(payload,bytes) else ws.send_json(payload)
                self.until(ws,'error');self.until(ws,'closed')
            self.assertFalse(self.f.state()['private_session']['busy'])
        self.assertEqual(self.live.pcm,[])

    def test_stop_interrupts_a_paced_saved_clip(self):
        async def decode(clip_id):return b'\x00\x01'*160000
        self.f.app.state.live_audio.fixture_pcm=decode
        clip=self.f.service.eligible_clips(self.f.room,self.f.state()['me'])[0]
        with self.connect() as ws:
            self.hello(ws,input_mode='recordings');self.until(ws,'turn_complete')
            ws.send_json({'type':'play_fixture','clip_id':clip['id']});self.until(ws,'fixture_audio')
            ws.send_json({'type':'stop'});self.until(ws,'closed')
        saved=self.f.state()['private_session']['live_history'][0]
        self.assertLess(saved['input_audio_seconds'],1)
        self.assertFalse(self.f.state()['private_session']['busy'])
