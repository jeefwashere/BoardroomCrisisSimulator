"""Recorded guidance is authenticated playback, never a human vote or contribution."""
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from playtest.decision_prompt import DecisionPrompt
from playtest.engine import RuleError
from playtest.roundtable import Roundtable


class DecisionPromptTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)/'prompt.mp3'; self.path.write_bytes(b'recorded fixture')
        self.now = 1000.
        self.engine = Roundtable(clock=lambda: self.now)
        a = self.engine.join('CEO'); b = self.engine.join('Member', a['code'])
        self.tokens = [a['token'], b['token']]
        self.room = self.engine.rooms[a['code']]
        self.room.update(phase='decision', documents=[{'id':'T01'}],
                         decisions=[{'id':'t01_response','mode':'fixed_choice','status':'pending','ballots':{}}])
        library = SimpleNamespace(get=lambda _: ({'text':'Choose one of the three responses.', 'duration_seconds':20}, self.path))
        app = FastAPI()
        @app.exception_handler(RuleError)
        def error(request, exc):return JSONResponse({'error':exc.message},status_code=exc.status)
        app.include_router(DecisionPrompt(SimpleNamespace(engine=self.engine),library).router,prefix='/api/roundtable')
        self.client = TestClient(app); self.addCleanup(self.client.close)
    def get(self, suffix='', who=0):
        return self.client.get('/api/roundtable/decision-prompt'+suffix,headers={'Authorization':'Bearer '+self.tokens[who]})
    def stop(self, who=0):
        return self.client.post('/api/roundtable/decision-prompt/stop',headers={'Authorization':'Bearer '+self.tokens[who]},json={})
    def test_metadata_requires_membership_and_matching_phase(self):
        self.assertEqual(self.client.get('/api/roundtable/decision-prompt').status_code,401)
        self.assertEqual(self.get(who=1).json()['decision_id'],'t01_response')
        self.room['phase']='consultation'
        self.assertEqual(self.get().status_code,409)
    def test_other_document_or_room_cannot_get_scenario_prompt(self):
        self.room['documents']=[{'id':'T02'}]
        self.assertEqual(self.get().status_code,404)
        other=self.engine.join('Other')
        self.tokens.append(other['token'])
        self.assertEqual(self.get(who=2).status_code,409)
    def test_playback_is_ceo_only_and_changes_no_votes_or_transcript(self):
        self.assertEqual(self.get('/audio',who=1).status_code,403)
        response=self.get('/audio')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.content,b'recorded fixture')
        self.assertEqual(self.room['transcript'],[])
        self.assertEqual(self.room['decisions'][0]['ballots'],{})
        self.assertEqual(self.room['decisions'][0]['status'],'pending')
        self.assertEqual(self.room['active_audio']['kind'],'decision_prompt')
    def test_audio_excludes_other_streams_and_cannot_overlap_itself(self):
        self.room['active_stream']='live'
        self.assertEqual(self.get('/audio').status_code,409)
        self.room['active_stream']=None
        self.assertEqual(self.get('/audio').status_code,200)
        self.assertEqual(self.get('/audio').status_code,409)
    def test_stop_is_owned_and_idempotent(self):
        self.get('/audio')
        self.assertEqual(self.stop(1).status_code,403)
        self.assertEqual(self.stop().status_code,200)
        self.assertEqual(self.stop().status_code,200)
        self.assertIsNone(self.room['active_audio'])
        self.assertEqual(self.room['transcript'],[])
    def test_phase_change_and_expiry_release_audio(self):
        self.get('/audio'); self.now+=24
        self.engine.tick(self.room)
        self.assertIsNone(self.room['active_audio'])
        self.get('/audio');self.engine._transition(self.room,'ended')
        self.assertIsNone(self.room['active_audio'])
