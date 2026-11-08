import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient
from playtest.engine import Engine
from playtest.recordings import RecordingLibrary
from playtest.server import create_app
from playtest.tests.test_playtest import Clock, FakeProvider, FakeSpeech


class RecordingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.file = root / 'example.mp3'
        self.file.write_bytes(b'ID3FixtureAudio')
        (root/'manifest.json').write_text(json.dumps({'clips': {'example': {
            'sha256': hashlib.sha256(self.file.read_bytes()).hexdigest(),
            'text_sha256': hashlib.sha256(b'Jeff will call IT.').hexdigest(), 'duration_seconds': 3}}}))
        catalog = root/'catalog.json'
        catalog.write_text(json.dumps({'clips': [{'id': 'example', 'title': 'An example',
            'text': 'Jeff will call IT.', 'role': 'Fictional participant', 'group': 'discussion'}]}))
        self.library = RecordingLibrary(catalog, root)
        self.clock = Clock()
        self.engine = Engine(self.clock)
        self.speech = FakeSpeech(root)
        self.client = TestClient(create_app(self.engine, FakeProvider(), self.speech, recordings=self.library))
        self.addCleanup(self.client.close)
        self.addCleanup(self.client.app.state.agents.close)
        self.a = self.client.post('/api/join', json={'name': 'A'}).json()
        self.b = self.client.post('/api/join', json={'name': 'B', 'code': self.a['code']}).json()
        self.c = self.client.post('/api/join', json={'name': 'C', 'code': self.a['code']}).json()
        self.auth = self.headers(self.a)
        self.room = self.engine.rooms[self.a['code']]

    def headers(self, seat):
        return {'Authorization': 'Bearer '+seat['token']}

    def post(self, path, seat=None, **body):
        return self.client.post(path, json={'command_id': uuid.uuid4().hex, **body},
                                headers=self.headers(seat or self.a))

    def discussion(self):
        self.post('/api/command/start', profile='single_5')
        self.clock.now += 45
        self.client.get('/api/state', headers=self.auth)

    def test_catalog_and_audio_require_membership_and_audio_owner(self):
        self.assertEqual(self.client.get('/api/recordings').status_code, 401)
        catalog = self.client.get('/api/recordings', headers=self.auth).json()
        self.assertTrue(catalog['clips'][0]['available'])
        self.assertNotIn(str(self.temp.name), json.dumps(catalog))
        result = self.post('/api/recordings/play', clip_id='example').json()
        self.assertTrue(result['recorded'])
        url = '/api/audio/'+result['id']
        self.assertEqual(self.client.get(url, headers=self.auth).content, self.file.read_bytes())
        self.assertEqual(self.client.get(url, headers=self.headers(self.b)).status_code, 404)
        self.assertEqual(self.client.get(url).status_code, 401)

    def test_replays_do_not_spend_or_commit_and_duplicate_command_is_idempotent(self):
        initial = self.speech.budget.status()
        for _ in range(3):
            command = uuid.uuid4().hex
            result = self.post('/api/recordings/play', command_id=command, clip_id='example')
            repeated = self.post('/api/recordings/play', command_id=command, clip_id='example')
            self.assertEqual(result.json(), repeated.json())
            self.post('/api/speech/stop')
        self.assertEqual(self.speech.budget.status(), initial)
        self.assertEqual(self.speech.calls, 0)
        self.assertEqual(self.room['contributions'], [])
        self.assertEqual(self.room['history'], [])

    def test_wrong_turn_rejected_and_finish_revokes_lease(self):
        self.discussion()
        self.assertEqual(self.post('/api/recordings/play', self.b, clip_id='example').status_code, 403)
        result = self.post('/api/recordings/play', clip_id='example').json()
        self.assertEqual(self.post('/api/recordings/play', clip_id='example').status_code, 409)
        self.post('/api/command/finish')
        self.assertEqual(self.client.get('/api/audio/'+result['id'], headers=self.auth).status_code, 404)
        self.assertEqual(self.post('/api/recordings/play', self.b, clip_id='example').status_code, 200)

    def test_phase_change_and_shared_stop_revoke_audio(self):
        result = self.post('/api/recordings/play', clip_id='example').json()
        self.post('/api/command/start', profile='single_5')
        self.assertEqual(self.client.get('/api/audio/'+result['id'], headers=self.auth).status_code, 404)
        result = self.post('/api/recordings/play', clip_id='example').json()
        self.post('/api/speech/stop', self.b)
        self.assertEqual(self.client.get('/api/audio/'+result['id'], headers=self.auth).status_code, 404)

    def test_unknown_path_and_modified_recording_are_rejected(self):
        self.assertEqual(self.post('/api/recordings/play', clip_id='../example').status_code, 404)
        self.file.write_bytes(b'changed')
        self.assertEqual(self.post('/api/recordings/play', clip_id='example').status_code, 409)
        self.assertEqual(self.speech.budget.status()['reserved'], 0)

    def test_transcription_is_explicit_provisional_and_idempotent(self):
        self.assertEqual(self.post('/api/recordings/transcribe', clip_id='example').status_code, 409)
        self.discussion()
        self.assertEqual(self.post('/api/recordings/transcribe', self.b, clip_id='example').status_code, 403)
        def write_wav(ident, path):
            path.write_bytes(b'fake audio for fake speech provider')
            return path
        command = uuid.uuid4().hex
        with patch.object(self.library, 'wav', side_effect=write_wav) as convert:
            first = self.post('/api/recordings/transcribe', command_id=command, clip_id='example')
            again = self.post('/api/recordings/transcribe', command_id=command, clip_id='example')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), again.json())
        self.assertEqual(convert.call_count, 1)
        self.assertFalse(first.json()['committed'])
        self.assertTrue(first.json()['recorded_fixture'])
        self.assertEqual(self.room['contributions'], [])
        self.assertEqual(self.speech.budget.status()['reserved'], 400)
        self.post('/api/command/contribute', text=first.json()['text'], source='speech')
        self.assertEqual(len(self.room['contributions']), 1)

    def test_failed_conversion_does_not_charge_or_retry_automatically(self):
        self.discussion()
        with patch.object(self.library, 'wav', side_effect=ValueError('Conversion unavailable')) as convert:
            command = uuid.uuid4().hex
            self.assertEqual(self.post('/api/recordings/transcribe', command_id=command, clip_id='example').status_code, 422)
            self.assertEqual(self.post('/api/recordings/transcribe', command_id=command, clip_id='example').status_code, 409)
            self.assertEqual(convert.call_count, 1)
        self.assertEqual(self.speech.budget.status()['reserved'], 0)


if __name__ == '__main__':
    unittest.main()
