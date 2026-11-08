"""Authenticated original turn recordings and independently reviewed transcripts."""

import asyncio
import base64
from dataclasses import dataclass, field
from datetime import timedelta
import hashlib
import json
import math
import os
import subprocess
import shutil
import sqlite3
from pathlib import Path
from typing import Callable
from uuid import UUID, uuid4

from .rooms import RoomError, Rooms, StartedGame
from . import simulation as sim
from . import gameplay

MAX_BYTES = 10_000_000
MIMES = {'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/x-wav'}


@dataclass
class Recording:
    recording_id: UUID
    room_id: UUID
    member_id: UUID
    round_id: UUID
    round_number: int
    phase_id: UUID
    begun: float
    deadline: float
    started_at: object
    status: str = 'awaiting_audio'
    transcript: str = ''
    reviewed_text: str | None = None
    error: str | None = None
    mime_type: str | None = None
    digest: str | None = None
    audio_available: bool = False
    task: asyncio.Task | None = None
    duration_seconds: float | None = None
    submitted: float | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def view(self):
        return {key: getattr(self, key) for key in ('recording_id', 'member_id', 'round_number', 'phase_id',
                'status', 'transcript', 'reviewed_text', 'error', 'mime_type', 'audio_available')} | {
                    'round_id': self.round_id, 'started_at': self.started_at, 'duration_seconds': self.duration_seconds,
                    'ended_at': self.started_at + timedelta(seconds=self.duration_seconds) if self.duration_seconds is not None else None}


class Recordings:
    def __init__(self, rooms: Rooms, root: Path | None = None, transcriber: Callable | None = None):
        self.rooms = rooms
        self.root = root or Path(os.getenv('BOARDROOM_RECORDINGS_DIR', '.local/recordings'))
        self.transcriber = transcriber
        self.entries: dict[UUID, Recording] = {}
        self.commands: dict[tuple[str, UUID], UUID] = {}

    @classmethod
    def from_env(cls, rooms):
        transcribe = None
        if os.getenv('BOARDROOM_STT_ENABLED') == 'true':
            try:
                cap = float(os.getenv('BOARDROOM_VOICE_BUDGET_USD', '0'))
                rate = float(os.getenv('BOARDROOM_STT_USD_PER_MINUTE', '0'))
                key = os.getenv('ELEVENLABS_API_KEY', '')
                ledger = os.getenv('BOARDROOM_TTS_LEDGER', '')
                if all(math.isfinite(value) and value > 0 for value in (cap, rate)) and key and ledger:
                    from rehearsal.voice import ElevenSpeech, VoiceBudget
                    adapter = ElevenSpeech(key, VoiceBudget(ledger, cap), Path(ledger).parent / 'speech-cache', stt_per_minute=rate)
                    def convert(raw, mime):
                        adapter.budget.reserve('stt', rate)
                        boundary = 'boardroom_' + uuid4().hex
                        parts = []
                        for name, value in {'model_id': 'scribe_v2', 'diarize': 'false', 'tag_audio_events': 'false'}.items():
                            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
                        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="turn.{mime.split("/")[-1]}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + raw + b'\r\n')
                        parts.append(f'--{boundary}--\r\n'.encode())
                        return json.loads(adapter.request('/v1/speech-to-text', b''.join(parts), 'multipart/form-data; boundary=' + boundary))['text']
                    transcribe = convert
            except (ValueError, OSError, sqlite3.Error):
                transcribe = None
        return cls(rooms, transcriber=transcribe)

    async def begin(self, session, room_id, command_id, phase_id, round_id):
        room = self.rooms.require_room(room_id)
        async with room.lock:
            member = room.member(session)
            now = self.rooms.clock()
            self.rooms.reconcile(room, now)
            previous = self.commands.get((session, command_id))
            if previous:
                item = self.entries[previous]
                if (item.room_id, item.phase_id, item.round_id) != (room_id, phase_id, round_id):
                    raise RoomError(409, 'command_conflict', 'Recording command was reused')
                return item.view()
            if not isinstance(room.phase, StartedGame):
                raise RoomError(409, 'not_started', 'Start the game first')
            state = room.phase.state
            phase = state.phase
            if not isinstance(phase, sim.SpeakingPhase) or phase.phase_id != phase_id or state.round_id != round_id:
                raise RoomError(409, 'stale_turn', 'Recording requires the current speaking turn')
            if phase.order[phase.index] != member.member_id:
                raise RoomError(403, 'speaker_required', 'Only the current speaker may record')
            existing = next((item for item in self.entries.values() if item.phase_id == phase_id and item.member_id == member.member_id), None)
            if existing:
                self.commands[(session, command_id)] = existing.recording_id
                return existing.view()
            item = Recording(uuid4(), room_id, member.member_id, round_id, state.round_number, phase_id,
                             now, min(phase.deadline, state.session_deadline or phase.deadline), gameplay.at(state, now))
            self.entries[item.recording_id] = item
            self.commands[(session, command_id)] = item.recording_id
            room.touch(session, now)
            return item.view()

    def require(self, session, room_id, recording_id, own=False):
        room = self.rooms.require_room(room_id)
        member = room.member(session)
        item = self.entries.get(recording_id)
        if item is None or item.room_id != room_id:
            raise RoomError(404, 'recording_not_found', 'Recording is unavailable')
        if own and item.member_id != member.member_id:
            raise RoomError(403, 'recording_owner_required', 'Only the recording owner can submit or review it')
        return item

    async def upload(self, session, room_id, recording_id, encoded, mime):
        item = self.require(session, room_id, recording_id, own=True)
        async with item.lock:
            return await self._upload(item, encoded, mime)

    async def _upload(self, item, encoded, mime):
        recording_id = item.recording_id
        mime = mime.split(';')[0].lower()
        if mime not in MIMES or len(encoded) > 13_333_336:
            raise RoomError(422, 'invalid_audio', 'Use supported audio up to 10 MB')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except ValueError as error:
            raise RoomError(422, 'invalid_audio', 'Invalid audio encoding') from error
        signatures = {'audio/webm': raw.startswith(b'\x1aE\xdf\xa3'), 'audio/ogg': raw.startswith(b'OggS'),
                      'audio/mp4': len(raw) > 12 and raw[4:8] == b'ftyp',
                      'audio/wav': raw.startswith(b'RIFF') and raw[8:12] == b'WAVE',
                      'audio/x-wav': raw.startswith(b'RIFF') and raw[8:12] == b'WAVE'}
        if not 12 <= len(raw) <= MAX_BYTES or not signatures[mime]:
            raise RoomError(422, 'invalid_audio', 'Audio container does not match its type')
        digest = hashlib.sha256(raw).hexdigest()
        if item.digest:
            if item.digest != digest or item.mime_type != mime:
                raise RoomError(409, 'recording_frozen', 'Original audio cannot be replaced')
            return item.view()
        if self.rooms.clock() > item.deadline + 60:
            raise RoomError(409, 'recording_expired', 'The upload grace period has elapsed')
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root.chmod(0o700)
        path = self.root / (str(recording_id) + '.audio')
        # No await occurs between the immutable claim and atomic file replacement.
        temporary = path.with_suffix('.pending')
        temporary.write_bytes(raw)
        temporary.chmod(0o600)
        temporary.replace(path)
        item.digest, item.mime_type, item.audio_available = digest, mime, True
        item.submitted = self.rooms.clock()
        item.status = 'validating_audio'
        self.persist(item)
        item.task = asyncio.create_task(self._process(item, raw, path))
        return item.view()

    def _duration(self, path):
        binary = shutil.which('ffmpeg')
        if binary is None:
            raise ValueError('Install ffmpeg to validate browser recording duration')
        result = subprocess.run([binary, '-nostdin', '-v', 'error', '-i', str(path), '-t', '31',
                                 '-map', '0:a:0', '-f', 'null', '-', '-progress', 'pipe:1'],
                                capture_output=True, text=True, timeout=10, check=True)
        times = [int(line.split('=', 1)[1]) / 1_000_000 for line in result.stdout.splitlines() if line.startswith('out_time_us=')]
        duration = max(times, default=0)
        if not 0.1 <= duration <= 30.25:
            raise ValueError('Record 0.1 to 30 seconds')
        return duration

    def persist(self, item):
        data = item.view() | {'room_id': item.room_id, 'sha256': item.digest}
        path = self.root / (str(item.recording_id) + '.json')
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(data, default=str, indent=2))
        temporary.chmod(0o600)
        temporary.replace(path)

    async def _process(self, item, raw, path):
        try:
            item.duration_seconds = await asyncio.to_thread(self._duration, path)
            available = min(30, item.deadline - item.begun, item.submitted - item.begun)
            room = self.rooms.require_room(item.room_id)
            if isinstance(room.phase, StartedGame):
                completed = next((turn for turn in room.phase.state.turns if turn.phase_id == item.phase_id), None)
                if completed is not None:
                    available = min(available, (completed.ended_at - item.started_at).total_seconds())
            if item.duration_seconds > available + .25:
                raise ValueError('Audio extends past its authoritative speaking turn')
            if not self.transcriber:
                item.status = 'transcription_disabled'
                self.persist(item)
                return
            item.status = 'transcribing'
            await self._transcribe(item, raw)
        except Exception:
            item.status, item.error = 'audio_validation_failed', 'Audio could not be decoded or exceeds the allowed duration. Original bytes remain saved.'
        self.persist(item)

    async def _transcribe(self, item, raw):
        try:
            text = await asyncio.to_thread(self.transcriber, raw, item.mime_type)
            if not isinstance(text, str) or not text.strip() or len(text) > 12000:
                raise ValueError('Invalid transcript')
            item.transcript, item.status = text, 'review_required'
        except Exception:
            item.status, item.error = 'transcription_failed', 'Transcription unavailable. Original audio remains saved.'

    async def review(self, session, room_id, recording_id, text):
        item = self.require(session, room_id, recording_id, own=True)
        if not isinstance(text, str) or not 0 < len(text.strip()) <= 12000:
            raise RoomError(422, 'invalid_transcript', 'Review 1 to 12000 characters')
        if item.reviewed_text is not None:
            if item.reviewed_text != text:
                raise RoomError(409, 'transcript_frozen', 'Reviewed transcripts are immutable')
            return item.view()
        if item.status != 'review_required':
            raise RoomError(409, 'transcript_not_ready', 'Wait for transcription before reviewing')
        item.reviewed_text, item.status = text, 'reviewed'
        self.persist(item)
        return item.view()

    def audio(self, session, room_id, recording_id):
        item = self.require(session, room_id, recording_id)
        if not item.audio_available:
            raise RoomError(404, 'audio_not_ready', 'Audio has not been saved')
        return (self.root / (str(recording_id) + '.audio')).read_bytes(), item.mime_type

    def listing(self, session, room_id):
        self.rooms.require_room(room_id).member(session)
        return [item.view() for item in self.entries.values() if item.room_id == room_id]

    async def close(self):
        pending = [item for item in self.entries.values() if item.task is not None and not item.task.done()]
        for item in pending:
            item.task.cancel()
        await asyncio.gather(*(item.task for item in pending), return_exceptions=True)
        for item in pending:
            item.status, item.error = 'processing_interrupted', 'Server stopped during processing. Original audio is retained; no paid retry was made.'
            if item.audio_available:
                self.persist(item)
