import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid

from fastapi.testclient import TestClient
from playtest.server import create_app
from playtest.preparation_stream import split_speech
from playtest.speech import Speech
from playtest.vertex import VertexModels, VertexError
from playtest.tests.test_roundtable_api import MemoryFixture, ProviderFixture


FIRST = 'The shared report describes a service outage and an unavailable director. '
SECOND = 'The group should verify backup usability before promising recovery.'


class StreamingSpeech:
    adapter = object()
    def __init__(self):
        self.first_audio = threading.Event()
        self.calls = []
        self.fail = False
        self.budget = type('Budget', (), {'status': lambda _: {'remaining': 30000}})()
    def stream_pcm(self, text, cancel=None):
        self.calls.append(text)
        if self.fail:
            raise ValueError('Sensitive upstream response must never leak')
        self.first_audio.set()
        yield b'\x00\x01\x02'
        yield b'\x03\x04\x05'


class StreamingProvider(ProviderFixture):
    def __init__(self, speech):
        super().__init__()
        self.speech = speech
        self.overlap = False
        self.prompts = []
    def stream(self, prompt, cancel=None):
        self.prompts.append(prompt)
        yield FIRST
        if self.overlap and not self.speech.first_audio.wait(2):
            raise AssertionError('Speech must start before the second text delta is produced')
        if cancel and cancel.is_set():
            return
        yield SECOND


class StreamingRoutes(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.memory = MemoryFixture(self.temp.name)
        self.speech = StreamingSpeech()
        self.provider = StreamingProvider(self.speech)
        self.app = create_app(provider=self.provider, speech=self.speech, memory=self.memory)
        self.client = TestClient(self.app).__enter__()
        r = self.client.post('/api/roundtable/join', json={'name': 'Alex'}).json()
        self.token, self.code = r['token'], r['code']
        self.auth = {'Authorization': 'Bearer ' + self.token}
    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()
    def request(self, **options):
        return self.client.post('/api/roundtable/briefing', headers=self.auth,
                                json={'command_id': uuid.uuid4().hex, **options})
    def events(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return [json.loads(line) for line in response.text.splitlines()]
    def test_audio_arrives_while_gemini_is_still_writing(self):
        self.provider.overlap = True
        events = self.events(self.request())
        kinds = [e['type'] for e in events]
        self.assertLess(kinds.index('audio'), kinds.index('text_done'))
        self.assertEqual(''.join(e['text'] for e in events if e['type'] == 'text'), FIRST+SECOND)
        self.assertEqual(events[-1]['status'], 'done')
        self.assertEqual(self.memory.searches[0][1], ['demo-report'])
        self.assertNotIn('private-upload', self.provider.prompts[0])
        state = self.client.get('/api/roundtable/state', headers=self.auth).json()
        self.assertEqual(state['transcript'], [])
        self.assertEqual(state['decisions'], [])
        self.assertEqual(state['suggestions'][-1]['text'], FIRST+SECOND)
    def test_consultation_is_live_and_uses_fixed_choices_without_voting(self):
        service=self.app.state.roundtable_service
        room=service.engine.rooms[self.code]
        room.update(phase='consultation',documents=[{'id':'T01'}],documents_ready=True)
        events=self.events(self.request(kind='facilitator',voice=False))
        self.assertEqual(events[-1]['status'],'done')
        self.assertIn('controlled_continuity',self.provider.prompts[-1])
        self.assertIn('25 to 35 words',self.provider.prompts[-1])
        self.assertEqual(self.memory.searches[-1][1],['T01'])
        self.assertEqual(room['decisions'],[])
        self.assertEqual(room['transcript'],[])

    def test_introduction_keeps_ballot_options_out_of_the_timed_briefing(self):
        room=self.app.state.roundtable_service.engine.rooms[self.code]
        room.update(phase='preparation',documents=[{'id':'T01'}],documents_ready=True)
        self.events(self.request(kind='preparation',voice=False))
        self.assertNotIn('controlled_continuity',self.provider.prompts[-1])
        self.assertIn('50 to 60 words',self.provider.prompts[-1])

    def test_fixed_ballot_rejects_generated_decision_prompt(self):
        room=self.app.state.roundtable_service.engine.rooms[self.code]
        room.update(phase='decision',documents=[{'id':'T01'}],documents_ready=True)
        self.assertEqual(self.request(kind='decision',voice=False).status_code,409)
        self.assertEqual(self.provider.prompts,[])

    def test_text_only_needs_no_elevenlabs_configuration(self):
        self.speech.adapter = None
        events = self.events(self.request(voice=False))
        self.assertEqual(events[-1]['status'], 'done')
        self.assertFalse(any(e['type'] == 'audio' for e in events))
        self.assertEqual(self.speech.calls, [])
    def test_duplicate_request_never_spends_again(self):
        cid = uuid.uuid4().hex
        self.events(self.request(command_id=cid, voice=False))
        self.assertEqual(self.request(command_id=cid, voice=False).status_code, 409)
        self.assertEqual(len(self.provider.prompts), 1)

    def test_automatic_event_deduplication_across_new_command_ids(self):
        self.events(self.request(automatic=True,voice=False))
        self.assertEqual(self.request(automatic=True,voice=False).status_code,409)
        self.assertEqual(len(self.provider.prompts),1)
        self.events(self.request(automatic=False,voice=False))
        self.assertEqual(len(self.provider.prompts),2)

    def test_turn_change_cancels_live_consultation(self):
        service=self.app.state.roundtable_service
        with service.engine.lock:
            room=service.engine.rooms[self.code]
            room['phase']='discussion';room['turn_number']=1
        session=service.briefings.begin(self.token,{'command_id':uuid.uuid4().hex,'voice':False,'kind':'it'})
        room['turn_number']=2
        service.briefings.check_active()
        service.briefings.run(session)
        self.assertEqual(self.provider.prompts,[])
        self.assertIsNone(room['active_stream'])
    def test_speech_failure_preserves_streamed_text_without_retry(self):
        self.speech.fail = True
        events = self.events(self.request())
        self.assertTrue(events[-1]['speech_error'])
        self.assertEqual(events[-1]['status'], 'done')
        self.assertEqual(len(self.speech.calls), 1)
        self.assertNotIn('Sensitive upstream', json.dumps(events))
    def test_auth_and_voice_validation(self):
        self.assertEqual(self.client.post('/api/roundtable/briefing', json={}).status_code, 401)
        self.assertEqual(self.request(voice='yes').status_code, 422)
        self.assertEqual(self.request(mode='not-a-mode').status_code, 422)
    def test_cancel_before_work_stops_all_provider_calls(self):
        service = self.app.state.roundtable_service
        session = service.briefings.begin(self.token, {'command_id': uuid.uuid4().hex, 'voice': False})
        r = self.client.post('/api/roundtable/briefing/'+session['id']+'/stop', headers=self.auth, json={})
        self.assertEqual(r.status_code, 200)
        service.briefings.run(session)
        self.assertEqual(self.provider.prompts, [])
        self.assertEqual(service.engine.rooms[self.code]['jobs'][session['id']]['status'], 'cancelled')
    def test_changed_phase_invalidates_pending_stream(self):
        service = self.app.state.roundtable_service
        session = service.briefings.begin(self.token, {'command_id': uuid.uuid4().hex, 'voice': False})
        with service.engine.lock:
            service.engine.rooms[self.code]['phase'] = 'discussion'
        service.briefings.check_active()
        self.assertTrue(session['cancel'].is_set())
        service.briefings.run(session)
        self.assertEqual(self.provider.prompts, [])
    def test_other_room_cannot_stop_stream(self):
        service = self.app.state.roundtable_service
        session = service.briefings.begin(self.token, {'command_id': uuid.uuid4().hex, 'voice': False})
        other = self.client.post('/api/roundtable/join', json={'name': 'Other'}).json()['token']
        r = self.client.post('/api/roundtable/briefing/'+session['id']+'/stop', json={}, headers={'Authorization':'Bearer '+other})
        self.assertEqual(r.status_code, 404)
        self.assertFalse(session['cancel'].is_set())
    def test_one_default_pdf_even_if_catalog_has_more(self):
        self.memory.documents.append({'id':'second-demo','title':'Second','demo':True})
        original = self.memory.status
        self.memory.status = lambda: {**original(), 'demo_document_ids':['demo-report','second-demo']}
        other = self.client.post('/api/roundtable/join', json={'name': 'Other'}).json()['token']
        state = self.client.get('/api/roundtable/state', headers={'Authorization':'Bearer '+other}).json()
        self.assertEqual([d['id'] for d in state['documents']], ['demo-report'])
        self.assertEqual(self.provider.prompts, [])

    def test_live_consultations_require_ceo_and_matching_phase(self):
        other = self.client.post('/api/roundtable/join', json={'name':'Morgan','code':self.code}).json()['token']
        self.assertEqual(self.request(kind='facilitator',voice=False).status_code,409)
        with self.app.state.roundtable.lock:
            self.app.state.roundtable.rooms[self.code]['phase'] = 'discussion'
        for kind in ('facilitator','it','journalist'):
            denied = self.client.post('/api/roundtable/briefing', headers={'Authorization':'Bearer '+other},
                json={'command_id':uuid.uuid4().hex,'kind':kind,'voice':False})
            self.assertEqual(denied.status_code,403)
            self.assertEqual(self.events(self.request(kind=kind,voice=False))[-1]['status'],'done')
        self.assertEqual(self.request(kind='decision',voice=False).status_code,409)

    def test_evaluation_uses_only_a_committed_decision(self):
        with self.app.state.roundtable.lock:
            room = self.app.state.roundtable.rooms[self.code]
            room['phase'] = 'decision'
            room['decisions'] = [{'id':'result1','status':'pending','problem':'Recovery promise',
                                 'proposal':'Verify backups first','tally':{'approve':2,'reject':1},'reason':'majority'}]
        self.assertEqual(self.request(kind='evaluation',decision_id='result1',voice=False).status_code,422)
        room['decisions'][0]['status'] = 'approved'
        events = self.events(self.request(kind='evaluation',decision_id='result1',voice=False))
        self.assertEqual(events[-1]['status'],'done')
        self.assertIn('"status": "approved"',self.provider.prompts[-1])
        self.assertIn('Verify backups first',self.provider.prompts[-1])
        self.assertEqual(room['decisions'][0]['status'],'approved')

    def test_removed_audio_site_is_not_served(self):
        for path in ('/audio-lab','/audio-lab.js','/audio-lab.css','/audio-guide'):
            self.assertEqual(self.client.get(path).status_code,404)


class ProviderStreaming(unittest.TestCase):
    def test_sse_deltas_and_shared_budget(self):
        payload = [
            {'candidates':[{'content':{'parts':[{'text':'private thought','thought':True},{'text':'First. '}]}}]},
            {'candidates':[{'content':{'parts':[{'text':'Second.'}]},'finishReason':'STOP'}],
             'usageMetadata':{'promptTokenCount':10,'candidatesTokenCount':4}}]
        class Opener:
            def open(self, request, timeout):
                self.url = request.full_url
                return io.BytesIO(b''.join(b'data: '+json.dumps(e).encode()+b'\n\n' for e in payload))
        with tempfile.TemporaryDirectory() as directory:
            opener = Opener()
            provider = VertexModels(key='test-key', directory=directory, opener=opener)
            self.assertEqual(list(provider.stream('A prompt')), ['First. ', 'Second.'])
            self.assertTrue(opener.url.endswith(':streamGenerateContent?alt=sse'))
            self.assertNotIn('test-key', opener.url)
            self.assertEqual(provider.budget.status()['attempts'], 1)
            self.assertEqual(provider.budget.status()['reserved_usd'], .05)
    def test_incomplete_sse_fails_without_automatic_retry(self):
        class Opener:
            calls = 0
            def open(self, *args, **kwargs):
                self.calls += 1
                return io.BytesIO(b'data: {"candidates":[]}\n\n')
        with tempfile.TemporaryDirectory() as directory:
            opener = Opener()
            provider = VertexModels(key='test-key', directory=directory, opener=opener)
            with self.assertRaises(VertexError): list(provider.stream('Prompt'))
            self.assertEqual(opener.calls, 1)
            self.assertEqual(provider.budget.status()['attempts'], 1)
    def test_speech_reserves_before_network_and_reads_chunks(self):
        with tempfile.TemporaryDirectory() as directory:
            speech = Speech('test-key', directory, 30000)
            speech.voice = 'standardvoice'
            class Opener:
                def open(inner, request, timeout):
                    self.assertEqual(speech.budget.status()['reserved'], 5)
                    self.assertTrue(request.full_url.endswith('/stream?output_format=pcm_24000'))
                    return io.BytesIO(b'\x00\x01'*5000)
            with patch('playtest.speech.urllib.request.build_opener', return_value=Opener()):
                chunks = list(speech.stream_pcm('Hello'))
            self.assertGreater(len(chunks), 1)
            self.assertEqual(sum(map(len, chunks)), 10000)
            cancel = threading.Event(); cancel.set()
            self.assertEqual(list(speech.stream_pcm('Cancelled', cancel)), [])
            self.assertEqual(speech.budget.status()['reserved'], 5)
    def test_sentence_chunks_are_bounded_and_do_not_wait_for_all_text(self):
        parts, tail = split_speech(FIRST+'A partial thought')
        self.assertEqual(parts, [FIRST.strip()])
        self.assertEqual(tail, 'A partial thought')
        parts, tail = split_speech('x'*1300+'.', final=True)
        self.assertEqual(''.join(parts), 'x'*1300+'.')
        self.assertTrue(all(len(p) <= 320 for p in parts))


if __name__ == '__main__': unittest.main()
