"""HTTP integration checks. All inference, PDF encoding and speech are fake."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import io
import json
from pathlib import Path
import re
import tempfile
import threading
import time
import unittest
import uuid
import wave

from fastapi.testclient import TestClient

from playtest.roundtable import Roundtable
from playtest.server import create_app
from playtest.speech import CreditBudget


class MemoryFixture:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.ready = True
        self.documents = [
            {'id': 'demo-report', 'title': 'Public report', 'filename': 'demo.pdf', 'pages': 1, 'kind': 'demo', 'demo': True},
            {'id': 'private-upload', 'title': 'Other room report', 'filename': 'private.pdf', 'pages': 1, 'kind': 'upload', 'demo': False},
        ]
        self.searches, self.uploads = [], []
        self.upload_started = threading.Event()
        self.upload_release = None
        for document in self.documents:
            self.document_path(document['id']).write_bytes(b'%PDF-1.4\nFake document for HTTP download testing')

    def status(self):
        return {'ready': self.ready, 'model': 'fixture-embedding', 'documents': deepcopy(self.documents),
                'demo_document_ids': ['demo-report'], 'model_cached': True, 'note': 'Fake embeddings for tests'}

    def search(self, question, document_ids=None, limit=5):
        self.searches.append((question, list(document_ids) if document_ids is not None else None))
        docs = ['demo-report'] if document_ids is None else document_ids
        return [{'id': 'demo_chunk' if identifier == 'demo-report' else identifier + '_chunk',
                 'document_id': identifier, 'title': 'Public report' if identifier == 'demo-report' else 'Uploaded report',
                 'filename': 'demo.pdf', 'page': 1,
                 'text': 'Backup verification remains incomplete.', 'score': .8} for identifier in docs][:limit]

    def document_path(self, identifier):
        if identifier not in {document['id'] for document in self.documents}:
            raise KeyError(identifier)
        return self.directory / (identifier + '.pdf')

    def add_pdf(self, data, filename):
        self.upload_started.set()
        if self.upload_release is not None and not self.upload_release.wait(3):
            raise ValueError('Test upload release timed out')
        document = {'id': 'upload-' + str(len(self.uploads) + 1), 'title': 'Room uploaded report',
                    'filename': filename, 'pages': 1, 'kind': 'upload', 'demo': False}
        self.documents.append(document)
        self.uploads.append((data, filename))
        self.document_path(document['id']).write_bytes(data)
        return deepcopy(document)


class ProviderFixture:
    def __init__(self):
        self.calls = []
        self.invalid = False
        self.fail = False
        self.started = threading.Event()
        self.release = None

    def request(self, path):
        return {'online': True, 'model': 'fake-text', 'thinking_level': 'LOW'}

    def run(self, prompt, model='text', timeout=120):
        self.calls.append((prompt, model))
        self.started.set()
        if self.release is not None and not self.release.wait(3):
            raise ValueError('Test provider release timed out')
        if self.fail:
            raise RuntimeError('fixture provider unavailable')
        if self.invalid:
            return {'text': json.dumps({'evidence_ids': ['other_room_secret'],
                                       'highlight_ids': ['other_room_secret'],
                                       'decision_source_ids': ['other_room_secret']})}
        ids = list(dict.fromkeys(re.findall(r'[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}_e\d+', prompt)))
        evidence = ['question_0'] if 'clarification prompts' in prompt else ['demo_chunk']
        return {'text': json.dumps({'evidence_ids': evidence, 'highlight_ids': ids[:2],
                                   'decision_source_ids': ids[:1],
                                   'text': 'Invented model prose must never become an authoritative fact.'})}


class SpeechFixture:
    def __init__(self, directory):
        self.budget = CreditBudget(Path(directory) / 'speech.sqlite', 1000)
        self.adapter = True
        self.calls = 0
        self.clip_paths = []

    def transcribe(self, path):
        self.calls += 1
        self.clip_paths.append(Path(path))
        if not Path(path).is_file():
            raise ValueError('No recording supplied')
        return {'text': 'Casey will check the backup.', 'source': 'speech', 'committed': False}


class RoundtableHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 1000.0
        self.engine = Roundtable(clock=lambda: self.now)
        self.memory = MemoryFixture(self.temp.name)
        self.provider = ProviderFixture()
        self.speech = SpeechFixture(self.temp.name)
        self.app = create_app(provider=self.provider, speech=self.speech,
                              roundtable=self.engine, memory=self.memory)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.client.__exit__, None, None, None)
        self.seats = [self.join('Alex')]
        self.code = self.seats[0]['code']
        self.seats.extend(self.join(name, self.code) for name in ('Blair', 'Casey'))

    def auth(self, who=0):
        seat = self.seats[who] if isinstance(who, int) else who
        return {'Authorization': 'Bearer ' + seat['token']}

    def join(self, name, code=None):
        response = self.client.post('/api/roundtable/join', json={'name': name, **({'code': code} if code else {})})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def state(self, who=0):
        response = self.client.get('/api/roundtable/state', headers=self.auth(who))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def command(self, action, who=0, **data):
        return self.client.post('/api/roundtable/command/' + action,
                                json={'command_id': uuid.uuid4().hex, **data}, headers=self.auth(who))

    def ok_command(self, action, who=0, **data):
        response = self.command(action, who, **data)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def ready(self):
        for who in range(3):
            self.ok_command('ready', who, ready=True)

    def discussion(self):
        self.ready()
        self.ok_command('start')
        self.now += 30
        self.assertEqual(self.state()['phase'], 'discussion')

    def ask(self, kind, **data):
        response = self.client.post('/api/roundtable/agent/' + kind,
                                   json={'command_id': uuid.uuid4().hex, **data}, headers=self.auth())
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['id']

    def wait_job(self, identifier):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            state = self.state()
            job = next((job for job in state['jobs'] if job['id'] == identifier), None)
            if job is not None and job['status'] not in {'queued', 'pending', 'running'}:
                return state, job
            time.sleep(.01)
        self.fail('Model fixture job did not complete')

    @staticmethod
    def wav():
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as recording:
            recording.setnchannels(1)
            recording.setsampwidth(2)
            recording.setframerate(16000)
            recording.writeframes(b'\0\0' * 1600)
        return buffer.getvalue()

    def test_new_routes_require_membership_and_correct_origin(self):
        for path in ('state', 'memory', 'documents/demo-report'):
            self.assertEqual(self.client.get('/api/roundtable/' + path).status_code, 401)
        for path in ('/roundtable', '/roundtable.js', '/roundtable.css', '/roundtable-guide'):
            self.assertEqual(self.client.get(path).status_code, 200, path)
        response = self.client.get('/api/roundtable/state', headers={**self.auth(), 'Origin': 'https://foreign.example'})
        self.assertEqual(response.status_code, 403)
        self.assertIs(self.app.state.roundtable, self.engine)
        self.assertIs(self.app.state.roundtable_service.memory, self.memory)
        legacy = self.client.post('/api/join', json={'name': 'Legacy room'}).json()
        self.assertEqual(self.client.get('/api/roundtable/state', headers={'Authorization': 'Bearer ' + legacy['token']}).status_code, 401)
        self.assertEqual(self.client.get('/api/state', headers=self.auth()).status_code, 401)

    def test_default_documents_exclude_unrelated_uploads(self):
        state = self.state()
        self.assertTrue(state['documents_ready'])
        self.assertEqual([document['id'] for document in state['documents']], ['demo-report'])
        response = self.client.get('/api/roundtable/memory', headers=self.auth())
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('private-upload', json.dumps(response.json()))
        self.assertEqual(self.client.get('/api/roundtable/documents/private-upload', headers=self.auth()).status_code, 404)
        response = self.client.get('/api/roundtable/documents/demo-report', headers=self.auth())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b'%PDF-'))

    def test_unavailable_memory_keeps_lobby_accessible_and_start_blocked(self):
        self.memory.status = lambda: {'ready': False, 'model': 'fixture-embedding',
                                      'documents': [], 'note': 'PDF index is unreadable'}
        newcomer = self.join('Memory unavailable room')
        state = self.state(newcomer)
        self.assertEqual(state['phase'], 'lobby')
        self.assertFalse(state['documents_ready'])
        self.assertFalse(state['can_start'])
        self.assertEqual(state['documents'], [])
        self.ready()
        self.assertEqual(self.command('start').status_code, 409)
        self.assertEqual(self.provider.calls, [])

    def test_ceo_start_requires_ready_roster_and_freezes_documents(self):
        self.assertEqual(self.command('start').status_code, 409)
        self.ready()
        self.assertEqual(self.command('start', 1).status_code, 403)
        self.assertEqual(self.ok_command('start')['phase'], 'preparation')
        self.assertEqual(self.command('finish_discussion', 1).status_code, 403)
        response = self.client.post('/api/roundtable/upload', content=b'%PDF-1.4\nTest',
            headers={**self.auth(), 'Content-Type': 'application/pdf', 'X-Filename': 'late.pdf'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.memory.uploads, [])

    def test_upload_requires_host_or_ceo_and_stays_in_one_room(self):
        outsider = self.join('Other room')
        headers = {'Content-Type': 'application/pdf', 'X-Filename': 'room.pdf'}
        response = self.client.post('/api/roundtable/upload', content=b'%PDF-1.4\nRoom data',
                                    headers={**self.auth(1), **headers})
        self.assertEqual(response.status_code, 403)
        response = self.client.post('/api/roundtable/upload', content=b'%PDF-1.4\nRoom data',
                                    headers={**self.auth(), **headers})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('upload-1', [document['id'] for document in self.state()['documents']])
        self.assertNotIn('upload-1', json.dumps(self.state(outsider)))
        self.assertEqual(self.client.get('/api/roundtable/documents/upload-1', headers=self.auth(outsider)).status_code, 404)
        self.assertEqual(self.client.get('/api/roundtable/documents/upload-1', headers=self.auth()).status_code, 200)
        third = self.join('Later room')
        self.assertNotIn('upload-1', json.dumps(self.state(third)))

    def test_pending_upload_blocks_start_and_resets_ready(self):
        self.ready()
        self.memory.upload_release = threading.Event()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.client.post, '/api/roundtable/upload', content=b'%PDF-1.4\nRoom data',
                                 headers={**self.auth(), 'Content-Type': 'application/pdf', 'X-Filename': 'room.pdf'})
            try:
                self.assertTrue(self.memory.upload_started.wait(2))
                self.assertFalse(self.state()['documents_ready'])
                self.assertEqual(self.command('start').status_code, 409)
            finally:
                self.memory.upload_release.set()
            response = future.result(timeout=3)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(all(not member['ready'] for member in self.state()['members']))

    def test_preparation_uses_room_documents_and_page_citations(self):
        identifier = self.ask('preparation', text='What is known about backups?')
        state, job = self.wait_job(identifier)
        self.assertEqual(job['status'], 'done', job)
        self.assertEqual(self.memory.searches[-1][1], ['demo-report'])
        reply = next(reply for reply in state['suggestions'] if reply['id'] == identifier)
        self.assertIn('Backup verification remains incomplete.', reply['text'])
        self.assertEqual(reply['citations'][0]['document_id'], 'demo-report')
        self.assertEqual(reply['citations'][0]['page'], 1)
        self.assertNotIn('Invented model prose', json.dumps(reply))
        self.assertEqual(state['phase'], 'lobby')
        self.assertEqual(state['history'], [])
        self.assertTrue(all(model == 'text' for _, model in self.provider.calls))
        self.assertNotIn('Other room report', self.provider.calls[-1][0])
        self.assertNotIn('private-upload', self.provider.calls[-1][0])

    def test_invalid_citation_cannot_become_preparation_fact(self):
        self.provider.invalid = True
        identifier = self.ask('preparation', text='Find evidence')
        state, job = self.wait_job(identifier)
        self.assertEqual(job['status'], 'failed', job)
        self.assertFalse(any(reply['id'] == identifier for reply in state['suggestions']))
        self.assertEqual(state['history'], [])
        self.assertEqual(state['phase'], 'lobby')

    def test_facilitator_requires_ceo_and_all_consultation_phases(self):
        body = {'command_id': uuid.uuid4().hex, 'text': 'What next?'}
        response = self.client.post('/api/roundtable/agent/facilitator', json=body, headers=self.auth())
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.provider.calls, [])
        self.ready()
        self.ok_command('start')
        response = self.client.post('/api/roundtable/agent/facilitator', json=body, headers=self.auth())
        self.assertEqual(response.status_code, 409)
        self.now += 30
        self.state()
        response = self.client.post('/api/roundtable/agent/facilitator', json=body, headers=self.auth(1))
        self.assertEqual(response.status_code, 403)
        identifier = self.ask('facilitator', text='What next?')
        state, job = self.wait_job(identifier)
        self.assertEqual(job['status'], 'done', job)
        reply = next(reply for reply in state['suggestions'] if reply['id'] == identifier)
        self.assertEqual(reply['evidence_ids'], ['question_0'])
        self.assertIn('Which facts are confirmed', reply['text'])
        self.assertEqual(state['phase'], 'discussion')
        self.assertEqual(state['transcript'], [])
        self.assertEqual(state['history'], [])
        self.ok_command('finish_discussion')
        self.assertEqual(self.state()['phase'], 'consultation')
        identifier = self.ask('facilitator', text='What should we decide?')
        state, job = self.wait_job(identifier)
        self.assertEqual(job['status'], 'done', job)
        self.assertEqual(state['phase'], 'consultation')
        self.ok_command('skip_consultation')
        self.assertEqual(self.state()['phase'], 'decision')

    def test_late_facilitator_reply_is_discarded_after_early_finish(self):
        self.discussion()
        self.provider.release = threading.Event()
        identifier = self.ask('facilitator', text='What next?')
        try:
            self.assertTrue(self.provider.started.wait(2))
            self.ok_command('finish_discussion')
        finally:
            self.provider.release.set()
        state, job = self.wait_job(identifier)
        self.assertEqual(job['status'], 'discarded', job)
        self.assertEqual(state['phase'], 'consultation')
        self.assertFalse(any(reply['id'] == identifier for reply in state['suggestions']))

    def test_agent_retries_do_not_repeat_provider_requests(self):
        body = {'command_id': 'preparation-repeat', 'text': 'What is known about backups?'}
        first = self.client.post('/api/roundtable/agent/preparation', json=body, headers=self.auth())
        self.assertEqual(first.status_code, 200, first.text)
        self.wait_job(first.json()['id'])
        again = self.client.post('/api/roundtable/agent/preparation', json=body, headers=self.auth())
        self.assertEqual(again.json(), first.json())
        self.assertEqual(len(self.provider.calls), 1)
        conflict = self.client.post('/api/roundtable/agent/preparation',
                                   json={**body, 'text': 'Different question'}, headers=self.auth())
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(len(self.provider.calls), 1)

    def test_provider_failure_preserves_typed_meeting(self):
        self.provider.fail = True
        identifier = self.ask('preparation', text='What do we know?')
        _, job = self.wait_job(identifier)
        self.assertEqual(job['status'], 'failed', job)
        self.discussion()
        self.ok_command('next_turn')
        state = self.ok_command('contribute', 1, text='Preserve logs.', source='typed')
        self.assertEqual(state['transcript'][0]['text'], 'Preserve logs.')
        self.assertEqual(self.speech.calls, 0)

    def test_explicit_transcription_is_provisional_and_idempotent(self):
        audio = self.wav()
        headers = {**self.auth(2), 'Content-Type': 'audio/wav', 'X-Command-ID': 'speech-fixture-1'}
        response = self.client.post('/api/roundtable/transcribe', content=audio, headers=headers)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.speech.calls, 0)
        self.discussion()
        response = self.client.post('/api/roundtable/transcribe', content=audio, headers=headers)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.speech.calls, 0)
        self.ok_command('next_turn')
        self.ok_command('next_turn', 1)
        response = self.client.post('/api/roundtable/transcribe', content=audio, headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()['committed'])
        self.assertEqual(self.state()['transcript'], [])
        again = self.client.post('/api/roundtable/transcribe', content=audio, headers=headers)
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(self.speech.calls, 1)
        self.assertTrue(all(not path.exists() for path in self.speech.clip_paths))
        state = self.ok_command('contribute', 2, text=response.json()['text'], source='speech')
        self.assertEqual(state['transcript'][0]['member'], self.state(2)['me'])
        self.assertEqual(state['transcript'][0]['source'], 'speech')
        conflict = self.client.post('/api/roundtable/transcribe', content=audio + b'changed', headers=headers)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(self.speech.calls, 1)

    def test_discussion_sources_and_automatic_minutes_have_no_authority(self):
        self.discussion()
        self.ok_command('next_turn')
        self.ok_command('contribute', 1, text='Blair will verify backups by 3 PM.')
        self.ok_command('next_turn', 1)
        self.ok_command('contribute', 2, text='Who owns the public update?')
        self.ok_command('finish_discussion')
        self.ok_command('skip_consultation')
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            state = self.state()
            jobs = [job for job in state['jobs'] if job['kind'] == 'minutes']
            if jobs:
                state, job = self.wait_job(jobs[0]['id'])
                break
            time.sleep(.01)
        else:
            self.fail('No automatic minutes job was requested')
        self.assertEqual(job['status'], 'done', job)
        self.assertEqual(len([job for job in state['jobs'] if job['kind'] == 'minutes']), 1)
        sources = {entry['id']: entry['text'] for entry in state['transcript']}
        self.assertTrue(state['summary']['items'])
        for item in state['summary']['items']:
            self.assertTrue(item['source_ids'])
            for identifier in item['source_ids']:
                self.assertIn(sources[identifier], item['text'])
        for prompt in state['decision_prompts']:
            self.assertTrue(set(prompt['source_ids']) <= set(sources))
        self.assertEqual(state['decisions'], [])
        self.assertEqual(state['history'], [])
        self.assertNotIn('Invented model prose', json.dumps(state['summary']))
        self.assertEqual(state['phase'], 'decision')
        for _ in range(3):
            self.state()
        self.assertEqual(len([job for job in self.state()['jobs'] if job['kind'] == 'minutes']), 1)


if __name__ == '__main__':
    unittest.main()
