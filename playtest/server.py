"""Local FastAPI test UI. One process, one worker, secrets remain on the server."""
from contextlib import asynccontextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from .engine import Engine, RuleError, require
from .agents import Agents
from .speech import Speech

STATIC = Path(__file__).parent / 'static'


def create_app(engine=None, provider=None, speech=None, port=8788):
    engine = engine or Engine()
    agents = Agents(engine, provider)
    speech = speech or Speech(os.environ.get('ELEVENLABS_API_KEY'), '.local/ai-playtest', 0)
    media_receipts, media_lock = {}, threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        agents.start()
        yield
        agents.close()

    app = FastAPI(title='Rehearsal AI Playtest', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.engine, app.state.agents, app.state.speech = engine, agents, speech

    @app.middleware('http')
    async def boundaries(request, call_next):
        host = request.headers.get('host', '')
        allowed = {f'localhost:{port}', f'127.0.0.1:{port}', 'testserver'}
        origin = request.headers.get('origin')
        if host not in allowed or (origin and origin not in {f'http://localhost:{port}', f'http://127.0.0.1:{port}', 'http://testserver'}):
            return JSONResponse({'error': 'Use the local application origin'}, status_code=403)
        if request.method == 'POST':
            try:
                size = int(request.headers.get('content-length', '-1'))
            except ValueError:
                size = -1
            limit = 4_000_000 if request.url.path == '/api/transcribe' else 16_000
            if not 0 <= size <= limit:
                return JSONResponse({'error': 'Request body is missing a valid length or is too large'}, status_code=413)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        return response

    @app.exception_handler(RuleError)
    async def rule_error(request, exc):
        return JSONResponse({'error': exc.message}, status_code=exc.status)

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse({'error': str(exc)}, status_code=422)

    def token(request):
        auth = request.headers.get('authorization', '')
        require(auth.startswith('Bearer '), 'Join a room first', 401)
        return auth[7:]

    def media_once(request, cid, fingerprint, action):
        auth = token(request)
        with engine.lock:
            engine.identity(auth)
        require(isinstance(cid, str) and 8 <= len(cid) <= 80, 'A command ID is required', 422)
        key = (auth, cid)
        with media_lock:
            if key in media_receipts:
                entry = media_receipts[key]
                require(entry['fingerprint'] == fingerprint, 'Command ID used with different media')
                require(entry['status'] != 'pending', 'Media request is already pending; wait before retrying')
                require(entry['status'] == 'done', 'The prior media request failed. Credits remain reserved; retry needs a new command ID.')
                return deepcopy(entry['result'])
            require(len(media_receipts) < 10000, 'Media request capacity reached', 429)
            require(sum(x['status'] == 'pending' for x in media_receipts.values()) < 3, 'Speech queue is busy', 429)
            media_receipts[key] = {'fingerprint': fingerprint, 'status': 'pending'}
        try:
            result = action()
        except (RuleError, ValueError):
            with media_lock:
                media_receipts[key]['status'] = 'failed'
            raise
        except Exception:
            with media_lock:
                media_receipts[key]['status'] = 'failed'
            raise RuleError('Speech provider request failed. Continue with text. Failed requests remain reserved.', 502)
        with media_lock:
            media_receipts[key].update(status='done', result=deepcopy(result))
        return result

    @app.get('/')
    def index():
        return FileResponse(STATIC / 'index.html')

    @app.get('/app.js')
    def script():
        return FileResponse(STATIC / 'app.js', media_type='text/javascript')

    @app.get('/style.css')
    def css():
        return FileResponse(STATIC / 'style.css', media_type='text/css')

    @app.get('/meeting')
    def meeting():
        return FileResponse(STATIC / 'meeting.html')

    @app.get('/meeting.js')
    def meeting_script():
        return FileResponse(STATIC / 'meeting.js', media_type='text/javascript')

    @app.get('/meeting.css')
    def meeting_style():
        return FileResponse(STATIC / 'meeting.css', media_type='text/css')

    @app.get('/api/health')
    def health():
        return {'ok': True, 'storage': 'single process memory', 'models': agents.status,
                'test_name_rejoin': engine.allow_name_rejoin,
                'speech': speech.budget.status(), 'speech_configured': bool(speech.adapter)}

    @app.post('/api/join')
    def join(data: dict, request: Request):
        auth = request.headers.get('authorization', '').removeprefix('Bearer ')
        return engine.join(data.get('name'), data.get('code') or None, auth)

    @app.get('/api/state')
    def state(request: Request):
        snapshot = engine.snapshot(token(request))
        # Never expose provider identifiers, prompts or application credentials.
        snapshot['jobs'] = [{k: j.get(k) for k in ('id', 'kind', 'member', 'status', 'round', 'error', 'submitted_at', 'completed_at', 'timing', 'question', 'review')} for j in snapshot['jobs']]
        if snapshot['speech']:
            snapshot['speech'].pop('path', None)
        return snapshot

    @app.get('/api/documents')
    def documents(request: Request):
        with engine.lock:
            engine.identity(token(request))
        return {'documents': engine.documents()}

    @app.get('/api/reference-packs')
    def reference_packs(request: Request):
        with engine.lock:
            engine.identity(token(request))
        return agents.references.public()

    @app.post('/api/command/{action}')
    def command(action: str, data: dict, request: Request):
        return engine.command(token(request), action, data)

    @app.post('/api/agent/{kind}')
    def agent(kind: str, data: dict, request: Request):
        return agents.request(token(request), kind, data)

    @app.post('/api/speak')
    def speak(data: dict, request: Request):
        auth = token(request)
        def generate():
            with engine.lock:
                r, mid = engine.identity(auth)
                require(r['phase'] != 'lobby', 'Start the exercise first')
                require(not r['speech'] or r['speech']['expires'] <= engine.clock(), 'Another device owns the current speech. Stop it first.')
                source = data.get('source')
                if source == 'inject':
                    text = engine.inject(r)
                elif source == 'suggestion':
                    item = next((x for x in r['suggestions'] if x['id'] == data.get('id')), None)
                    require(item is not None, 'Suggestion not found', 404)
                    require(item['round'] == r['round'], 'That suggestion belongs to an earlier round')
                    text = item['text']
                else:
                    raise RuleError('Select the situation or an existing agent response', 422)
                text = text[:500]
                lease = {'id': uuid.uuid4().hex, 'member': mid, 'phase': r['phase'], 'round': r['round'],
                         'expires': min(engine.clock() + 60, r['deadline'] or engine.clock() + 60),
                         'text': text, 'status': 'generating'}
                r['speech'] = lease
            try:
                result = speech.speak(text)
                with engine.lock:
                    engine.tick(r)
                    require(r['speech'] is lease and lease['expires'] > engine.clock(), 'Speech cancelled because the turn or phase changed')
                    lease.update(path=result['path'], status='ready')
                    return {'id': lease['id'], 'captions': text, 'cached': result['cached'], 'expires': lease['expires']}
            except Exception:
                with engine.lock:
                    if r['speech'] is lease:
                        r['speech'] = None
                raise
        return media_once(request, data.get('command_id'), json.dumps(['speak', data], sort_keys=True), generate)

    @app.get('/api/audio/{speech_id}')
    def audio(speech_id: str, request: Request):
        with engine.lock:
            r, mid = engine.identity(token(request))
            lease = r['speech']
            require(lease and lease['id'] == speech_id and lease['member'] == mid and
                    lease['expires'] > engine.clock() and lease['status'] == 'ready', 'Speech lease is no longer valid', 404)
            return FileResponse(lease['path'], media_type='audio/mpeg')

    @app.post('/api/speech/stop')
    def stop_speech(data: dict, request: Request):
        with engine.lock:
            r, mid = engine.identity(token(request))
            if r['speech'] and (data.get('id') is None or data.get('id') == r['speech']['id']):
                engine.event(r, 'speech_stopped', by=mid, delivered=data.get('delivered') is True and r['speech']['member'] == mid)
                r['speech'] = None
            return {'ok': True}

    @app.post('/api/transcribe')
    async def transcribe(request: Request):
        # Receiving bytes is async; provider work runs outside the event loop and state lock.
        import asyncio
        payload = await request.body()
        require(len(payload) <= 4_000_000, 'Recording too large', 413)
        auth = token(request)
        with engine.lock:
            r, mid = engine.identity(auth)
            require(r['phase'] == 'discussion' and mid in r['electorate'], 'Record during an eligible discussion')
            require(r.get('speaker') in (None, mid), 'Wait for your speaking turn')
        def transcribe_file():
            with tempfile.TemporaryDirectory(prefix='rehearsal-') as directory:
                path = Path(directory) / 'clip.wav'
                path.write_bytes(payload)
                path.chmod(0o600)
                return speech.transcribe(path)
        return await asyncio.to_thread(media_once, request, request.headers.get('x-command-id'),
                                       'wav:' + hashlib.sha256(payload).hexdigest(), transcribe_file)

    return app
