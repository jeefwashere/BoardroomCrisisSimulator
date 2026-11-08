"""Authenticated prerecorded turns for the roundtable; no paid provider calls."""
from copy import deepcopy
import json
import math
import uuid
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from .engine import require

DEFAULT_CLIPS = [f't01_dialogue_{number:02d}' for number in range(1, 10)]
ROUND_ONE_CLIPS = DEFAULT_CLIPS[:7] + ['r1_dialogue_08', 'r1_dialogue_09']


class RoundtableRecordings:
    def __init__(self, service, library):
        self.service, self.engine, self.library = service, service.engine, library
        self.receipts = {}
        self.router = APIRouter()
        self.routes()

    @staticmethod
    def token(request):
        auth = request.headers.get('authorization', '')
        require(auth.startswith('Bearer '), 'Join a room first', 401)
        return auth[7:]

    def once(self, auth, operation, data, action):
        cid = data.get('command_id')
        require(isinstance(cid, str) and 8 <= len(cid) <= 80, 'A command_id is required', 422)
        digest = json.dumps([operation, data], sort_keys=True)
        with self.engine.lock:
            room, mid = self.engine.identity(auth)
            key = (auth, cid)
            if key in self.receipts:
                old, result = self.receipts[key]
                require(old == digest, 'Command ID already used with different content', 409)
                return deepcopy(result)
            require(len(self.receipts) < 10000, 'Recording receipt limit reached', 429)
            result = action(room, mid)
            self.receipts[key] = digest, deepcopy(result)
            return result

    def current_lease(self, room, mid, ident):
        lease = room.get('active_audio')
        require(lease and lease['id'] == ident and lease['member'] == mid, 'Recording lease is unavailable', 404)
        require(room['phase'] == 'discussion' and room['speaker'] == mid and
                room['turn_number'] == lease['turn_number'] and lease['expires'] > self.engine.clock(),
                'This recorded speaking turn has ended', 409)
        return lease

    def routes(self):
        router, engine = self.router, self.engine

        @router.get('/recordings')
        def catalog(request: Request):
            with engine.lock:
                room, _ = engine.identity(self.token(request))
                selected = ROUND_ONE_CLIPS if engine.is_round_one(room) else DEFAULT_CLIPS
            clips = [clip for clip in self.library.entries() if clip['id'] in selected]
            for clip in clips:
                clip['turn_number'] = selected.index(clip['id']) + 1
                clip['default_seat'] = (clip['turn_number'] - 1) % 3
            return {'clips': clips, 'default_clip_ids': selected, 'script_length': len(selected),
                    'note': 'Nine fixed participant turns in order. Each clip belongs to one numbered speaking turn; the script does not repeat after turn nine. AI agent voices are not prerecorded here. Completion commits the exact caption and passes the turn; playback does not call a provider.'}

        @router.post('/recordings/play')
        def play(data: dict, request: Request):
            auth = self.token(request)
            def start(room, mid):
                require(room['phase'] == 'discussion' and room['speaker'] == mid,
                        'Only the current discussion speaker can play a recording', 403)
                require(not room.get('active_audio') and not room.get('active_stream'),
                        'Stop the current room audio before starting a recorded turn', 409)
                require(1 <= room['turn_number'] <= len(DEFAULT_CLIPS),
                        'The nine recorded turns are complete; continue by text or proceed to a decision', 409)
                selected = ROUND_ONE_CLIPS if engine.is_round_one(room) else DEFAULT_CLIPS
                assigned = selected[room['turn_number'] - 1]
                require(data.get('clip_id') == assigned,
                        'Only the recording assigned to this numbered speaking turn may play', 403)
                item, path = self.library.get(assigned)
                seconds = item.get('duration_seconds')
                require(type(seconds) in (int, float) and math.isfinite(seconds) and 0 < seconds <= 30,
                        'Recording duration is invalid', 422)
                now = engine.clock()
                expiry = min(now+60, room['deadline'] or now+60)
                require(expiry >= now+seconds, 'Not enough discussion time remains for this recording', 409)
                lease = {'id': uuid.uuid4().hex, 'member': mid, 'phase': 'discussion',
                         'turn_number': room['turn_number'], 'clip_id': item['id'], 'text': item['text'],
                         'path': str(path), 'duration_seconds': seconds, 'started_at': now,
                         'complete_after': now+seconds, 'expires': expiry, 'served_at': None,
                         'recorded': True, 'status': 'ready'}
                room['active_audio'] = lease
                engine.event(room, 'recording_started', member=mid, clip_id=item['id'], audio_id=lease['id'])
                return {k: lease[k] for k in ('id', 'clip_id', 'duration_seconds', 'started_at', 'complete_after', 'expires', 'turn_number', 'recorded')} | {'captions': item['text']}
            return self.once(auth, 'play', data, start)

        @router.get('/recordings/audio/{ident}')
        def audio(ident: str, request: Request):
            with engine.lock:
                room, mid = engine.identity(self.token(request))
                lease = self.current_lease(room, mid, ident)
                # A client must fetch bytes before the elapsed duration check begins.
                if lease['served_at'] is None:
                    lease['served_at'] = engine.clock()
                    lease['complete_after'] = engine.clock()+lease['duration_seconds']
                return FileResponse(lease['path'], media_type='audio/mpeg')

        @router.post('/recordings/complete')
        def complete(data: dict, request: Request):
            auth = self.token(request)
            def finish(room, mid):
                lease = self.current_lease(room, mid, data.get('id'))
                require(lease['served_at'] is not None and engine.clock() >= lease['complete_after'],
                        'Recording has not completed its playback duration', 409)
                require(len(engine.receipts) <= 99998, 'Command capacity reached', 429)
                result = engine.contribute_recorded(auth, lease['text'], lease['clip_id'],
                                                    uuid.uuid4().hex, turn_number=lease['turn_number'])
                contribution_id = result['transcript'][-1]['id']
                next_state = engine.command(auth, 'next_turn', {'command_id': uuid.uuid4().hex,
                                                               'turn_number': lease['turn_number']})
                return {'ok': True, 'contribution_id': contribution_id, 'clip_id': lease['clip_id'],
                        'source': 'recorded', 'speaker': next_state['speaker'],
                        'turn_number': next_state['turn_number']}
            return self.once(auth, 'complete', data, finish)

        @router.post('/recordings/stop')
        def stop(data: dict, request: Request):
            def cancel(room, mid):
                lease = room.get('active_audio')
                require(lease and lease['id'] == data.get('id'), 'Recording lease is unavailable', 404)
                require(mid in (lease['member'], engine._ceo(room)), 'Only the speaker or CEO may stop this recording', 403)
                engine.cancel_audio(room, 'explicit_stop')
                return {'ok': True, 'committed': False}
            return self.once(self.token(request), 'stop', data, cancel)
