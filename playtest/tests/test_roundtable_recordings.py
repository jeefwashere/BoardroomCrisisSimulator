from types import SimpleNamespace
import unittest
import uuid
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from playtest.engine import RuleError
from playtest.recordings import RecordingLibrary
from playtest.roundtable import Roundtable
from playtest.roundtable_recordings import RoundtableRecordings


class RoundtableRecordingTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.
        self.engine = Roundtable(clock=lambda: self.now)
        seats = [self.engine.join('A')]
        seats += [self.engine.join(name, seats[0]['code']) for name in ('B', 'C')]
        self.tokens = [seat['token'] for seat in seats]
        self.room = self.engine.rooms[seats[0]['code']]
        self.engine.set_documents(seats[0]['code'], [{'id':'doc','title':'Public document'}], True)
        for token in self.tokens:
            self.engine.command(token, 'ready', {'command_id':uuid.uuid4().hex, 'ready':True})
        self.engine.command(self.tokens[0], 'start', {'command_id':uuid.uuid4().hex})
        self.now += self.engine.DURATIONS['preparation']
        self.engine.tick(self.room)
        app = FastAPI()
        @app.exception_handler(RuleError)
        def error(request, exc):
            return JSONResponse({'error':exc.message}, status_code=exc.status)
        self.recordings = RoundtableRecordings(SimpleNamespace(engine=self.engine), RecordingLibrary())
        app.include_router(self.recordings.router, prefix='/api/roundtable')
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def post(self, path, who=0, **data):
        return self.client.post('/api/roundtable/recordings/'+path,
                                json={'command_id':uuid.uuid4().hex, **data},
                                headers={'Authorization':'Bearer '+self.tokens[who]})

    def fetch(self, ident, who=0):
        return self.client.get('/api/roundtable/recordings/audio/'+ident,
                               headers={'Authorization':'Bearer '+self.tokens[who]})

    def test_exact_caption_commit_and_turn_advance_are_idempotent(self):
        result = self.post('play',clip_id='t01_dialogue_01').json()
        self.assertEqual(self.fetch(result['id']).status_code,200)
        self.now += result['duration_seconds'] + .1
        cid=uuid.uuid4().hex
        complete=self.post('complete',id=result['id'],command_id=cid)
        self.assertEqual(complete.status_code,200,complete.text)
        self.assertEqual(complete.json(), self.post('complete',id=result['id'],command_id=cid).json())
        self.assertEqual(len(self.room['transcript']),1)
        self.assertEqual(self.room['transcript'][0]['text'],result['captions'])
        self.assertEqual(self.room['transcript'][0]['source'],'recorded')
        self.assertEqual(self.room['turn_number'],2)
        self.assertIsNone(self.room['active_audio'])
        self.assertEqual(self.fetch(result['id']).status_code,404)

    def test_early_or_unfetched_completion_never_commits(self):
        result=self.post('play',clip_id='t01_dialogue_01').json()
        self.now+=result['duration_seconds']+1
        self.assertEqual(self.post('complete',id=result['id']).status_code,409)
        self.fetch(result['id'])
        self.assertEqual(self.post('complete',id=result['id']).status_code,409)
        self.assertEqual(self.room['transcript'],[])

    def test_wrong_speaker_cross_room_and_forged_caption_rejected(self):
        self.assertEqual(self.post('play',who=1,clip_id='t01_dialogue_01').status_code,403)
        result=self.post('play',clip_id='t01_dialogue_01').json()
        self.assertEqual(self.fetch(result['id'],who=1).status_code,404)
        outsider=self.engine.join('Outsider')['token']
        response=self.client.get('/api/roundtable/recordings/audio/'+result['id'],headers={'Authorization':'Bearer '+outsider})
        self.assertEqual(response.status_code,404)
        self.fetch(result['id']);self.now+=result['duration_seconds']+.1
        response=self.post('complete',id=result['id'],text='FORGED CAPTION')
        self.assertEqual(response.status_code,200)
        self.assertNotEqual(self.room['transcript'][0]['text'],'FORGED CAPTION')

    def test_cancel_and_phase_change_invalidate_completion(self):
        result=self.post('play',clip_id='t01_dialogue_01').json();self.fetch(result['id'])
        self.assertEqual(self.post('stop',id=result['id']).status_code,200)
        self.now+=10
        self.assertEqual(self.post('complete',id=result['id']).status_code,404)
        result=self.post('play',clip_id='t01_dialogue_01').json();self.fetch(result['id'])
        self.engine.command(self.tokens[0],'finish_discussion',{'command_id':uuid.uuid4().hex})
        self.now+=10
        self.assertEqual(self.post('complete',id=result['id']).status_code,404)
        self.assertEqual(self.room['transcript'],[])

    def test_active_stream_duplicate_play_and_receipt_conflicts(self):
        self.room['active_stream']='stream'
        self.assertEqual(self.post('play',clip_id='t01_dialogue_01').status_code,409)
        self.room['active_stream']=None
        cid=uuid.uuid4().hex
        result=self.post('play',clip_id='t01_dialogue_01',command_id=cid)
        self.assertEqual(result.json(),self.post('play',clip_id='t01_dialogue_01',command_id=cid).json())
        self.assertEqual(self.post('play',clip_id='t01_dialogue_02',command_id=cid).status_code,409)
        self.assertEqual(self.post('play',clip_id='t01_dialogue_02').status_code,409)

    def test_only_assigned_participant_clip_can_be_played(self):
        for forbidden in ('facilitator_open', 'journalist_confirmed', 't01_custom_decision_guide', 't01_dialogue_02'):
            self.assertEqual(self.post('play',clip_id=forbidden).status_code,403)
        self.assertIsNone(self.room['active_audio'])
        self.engine.command(self.tokens[0], 'next_turn', {'command_id':uuid.uuid4().hex})
        self.assertEqual(self.post('play',who=1,clip_id='t01_dialogue_01').status_code,403)
        self.assertEqual(self.post('play',who=1,clip_id='t01_dialogue_02').status_code,200)

    def test_nine_turn_sequence_rejects_future_clips_and_does_not_repeat(self):
        expected_text = []
        for index in range(9):
            who = index % 3
            clip_id = f't01_dialogue_{index+1:02d}'
            if index < 8:
                future = f't01_dialogue_{index+2:02d}'
                self.assertEqual(self.post('play',who=who,clip_id=future).status_code,403)
            response = self.post('play',who=who,clip_id=clip_id)
            self.assertEqual(response.status_code,200,response.text)
            result = response.json()
            expected_text.append(result['captions'])
            self.assertEqual(self.fetch(result['id'],who=who).status_code,200)
            self.now += result['duration_seconds']+.1
            completed = self.post('complete',who=who,id=result['id'])
            self.assertEqual(completed.status_code,200,completed.text)
            self.assertEqual(completed.json()['turn_number'],index+2)
        self.assertEqual([c['text'] for c in self.room['transcript']],expected_text)
        self.assertEqual(len(self.room['transcript']),9)
        self.assertEqual(self.post('play',clip_id='t01_dialogue_01').status_code,409)
        self.engine.command(self.tokens[0],'contribute',{'command_id':uuid.uuid4().hex,
                            'text':'One more clarification before we vote.','source':'typed'})
        self.assertEqual(len(self.room['transcript']),10)

    def test_catalog_authenticated_and_has_nine_numbered_turns_without_paths(self):
        self.assertEqual(self.client.get('/api/roundtable/recordings').status_code,401)
        response=self.client.get('/api/roundtable/recordings',headers={'Authorization':'Bearer '+self.tokens[0]})
        data=response.json()
        self.assertEqual(len(data['default_clip_ids']),9)
        self.assertEqual(sum(c['default_seat'] is not None for c in data['clips']),9)
        self.assertEqual(data['script_length'],9)
        self.assertEqual([c['turn_number'] for c in data['clips']],list(range(1,10)))
        self.assertEqual([c['default_seat'] for c in data['clips']],[0,1,2]*3)
        self.assertNotIn('path',data['clips'][0])
        self.assertEqual(self.post('play',clip_id='../secret').status_code,403)
        self.assertEqual(len(data['clips']),9)
        self.assertEqual({c['id'] for c in data['clips']},set(data['default_clip_ids']))


if __name__ == '__main__':
    unittest.main()
