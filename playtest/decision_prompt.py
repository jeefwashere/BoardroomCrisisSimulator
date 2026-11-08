"""One authenticated recorded decision prompt, separate from participant speech."""
import math
import uuid
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from .engine import require

PROMPT_ID = 't01_custom_decision_guide'


class DecisionPrompt:
    def __init__(self, service, library):
        self.engine, self.library = service.engine, library
        self.router = APIRouter()
        self.routes()

    def identity(self, request):
        auth = request.headers.get('authorization', '')
        require(auth.startswith('Bearer '), 'Join a room first', 401)
        return self.engine.identity(auth[7:])

    def decision(self, room):
        require(room['phase'] == 'decision', 'The recorded guide is available during decisions', 409)
        decision = next((d for d in room['decisions'] if d.get('mode') == 'fixed_choice'), None)
        require(decision is not None and [d['id'] for d in room['documents']] == ['T01'],
                'No recorded decision guide belongs to this room', 404)
        return decision

    def routes(self):
        @self.router.get('/decision-prompt')
        def metadata(request: Request):
            with self.engine.lock:
                room, _ = self.identity(request)
                decision = self.decision(room)
                clip, _ = self.library.get(PROMPT_ID)
                return {'clip_id': PROMPT_ID, 'text': clip['text'],
                        'audio_url': '/api/roundtable/decision-prompt/audio',
                        'decision_id': decision['id'], 'duration_seconds': clip['duration_seconds'],
                        'prerecorded': True}

        @self.router.get('/decision-prompt/audio')
        def audio(request: Request):
            with self.engine.lock:
                room, mid = self.identity(request)
                decision = self.decision(room)
                require(mid == self.engine._ceo(room), 'Only the CEO can play the shared decision guide', 403)
                require(not room.get('active_stream') and not room.get('active_audio'),
                        'Stop current room audio before playing the decision guide', 409)
                clip, path = self.library.get(PROMPT_ID)
                seconds = clip['duration_seconds']
                require(type(seconds) in (int, float) and math.isfinite(seconds) and 0 < seconds <= 30,
                        'Decision guide duration is invalid', 422)
                lease = {'id': uuid.uuid4().hex, 'kind': 'decision_prompt', 'phase': 'decision',
                         'member': mid, 'decision_id': decision['id'], 'clip_id': PROMPT_ID,
                         'expires': self.engine.clock()+seconds+3, 'status': 'playing'}
                room['active_audio'] = lease
                self.engine.event(room, 'decision_prompt_played', member=mid, decision_id=decision['id'])
            return FileResponse(path, media_type='audio/mpeg', headers={'Cache-Control': 'no-store'})

        @self.router.post('/decision-prompt/stop')
        def stop(request: Request):
            with self.engine.lock:
                room, mid = self.identity(request)
                lease = room.get('active_audio')
                if lease and lease.get('kind') == 'decision_prompt':
                    require(lease['member'] == mid, 'This playback belongs to another participant', 403)
                    self.engine.cancel_audio(room, 'decision_prompt_stopped')
            return {'ok': True}
