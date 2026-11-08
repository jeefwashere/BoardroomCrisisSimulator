"""Shared narration bytes. Rooms owns authentication and current phase checks."""

import asyncio
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass, field
import math
import os
from pathlib import Path
import sqlite3
from threading import Lock
from typing import Literal
from uuid import UUID


MAX_TEXT_CHARACTERS = 500
MAX_AUDIO_BYTES = 5_000_000


@dataclass(frozen=True)
class MediaResult:
    status: Literal["disabled", "pending", "ready", "failed"]
    text: str
    error: str | None = None


@dataclass(frozen=True)
class Delivery:
    member_id: UUID
    event: Literal["started", "completed", "failed"]


@dataclass
class _Entry:
    result: MediaResult
    task: asyncio.Task | None = None
    # Which speaker's voice to use (a key such as "coach" or "ceo"); None means the default voice.
    voice: str | None = None
    audio: bytes | None = None
    deliveries: tuple[Delivery, ...] = field(default_factory=tuple)
    # Streaming synthesis: chunks so far, shared by every listener; `streamed` marks a task that fills them.
    chunks: list[bytes] = field(default_factory=list)
    streamed: bool = False
    stream_ended: bool = False
    changed: asyncio.Condition | None = None


class NarrationService:
    """One event loop owns entries; only synthesis runs in a worker thread.

    A failed attempt is final. Cancelling a requesting coroutine leaves its
    shared synthesis running. This service never decides room membership or
    whether a narration still belongs to the current phase.
    """

    def __init__(self, synthesizer: Callable[..., bytes] | None = None,
                 streamer: Callable[[str, str | None], Iterator[bytes]] | None = None):
        self._synthesizer = synthesizer
        # Optional: yields audio chunks as they are produced, so playback can start before synthesis ends.
        self._streamer = streamer
        self._entries: dict[tuple[UUID, UUID], _Entry] = {}

    @classmethod
    def from_env(cls) -> "NarrationService":
        """Fail closed until every explicit spending prerequisite is supplied."""
        if os.environ.get("BOARDROOM_TTS_ENABLED") != "true":
            return cls()
        try:
            cap = float(os.environ.get("BOARDROOM_VOICE_BUDGET_USD", "0"))
            price = float(os.environ.get("BOARDROOM_TTS_USD_PER_1K", "0"))
        except ValueError:
            return cls()
        from .voices import voice_map
        voices = voice_map()
        voice = os.environ.get("BOARDROOM_TTS_VOICE_ID") or voices["facilitator"]
        ledger = os.environ.get("BOARDROOM_TTS_LEDGER", "")
        if (not all(math.isfinite(value) and value > 0 for value in (cap, price))
                or not voice or not all(c.isalnum() or c in "_-" for c in voice)
                or not ledger.strip()):
            return cls()
        key = os.environ.get("ELEVENLABS_API_KEY")
        if not key:
            return cls()

        # Lazy import and initialization preserve the zero spend default.
        from rehearsal.voice import ElevenSpeech, VoiceBudget

        try:
            ledger_path = Path(ledger).expanduser()
            cache = os.environ.get("BOARDROOM_TTS_CACHE") or str(ledger_path.parent / "boardroom-tts-cache")
            speech = ElevenSpeech(key, VoiceBudget(ledger_path, cap), cache, tts_per_1k=price)
        except (OSError, ValueError, sqlite3.Error):
            # Optional media setup must never prevent the text game starting.
            return cls()
        synthesis_lock = Lock()

        def synthesize(text: str, speaker: str | None = None) -> bytes:
            # ElevenSpeech owns disk caching and the shared budget reservation.
            # Serial access also protects its cache's single temporary filename.
            # 64 kbps keeps speech clear at half the bytes, so lines reach players sooner over the tunnel.
            with synthesis_lock:
                result = speech.speak(text, voices.get(speaker or "", voice), model_id="eleven_flash_v2_5",
                                      output_format="mp3_44100_64")
                with Path(result["path"]).open("rb") as audio:
                    return audio.read(MAX_AUDIO_BYTES + 1)

        def stream(text: str, speaker: str | None = None) -> Iterator[bytes]:
            return speech.stream(text, voices.get(speaker or "", voice), model_id="eleven_flash_v2_5")

        return cls(synthesize, stream)

    def _entry(self, room_id: UUID, narration_id: UUID, text: str) -> _Entry:
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARACTERS:
            raise ValueError("Narration text must contain 1 to 500 characters")
        key = (room_id, narration_id)
        entry = self._entries.get(key)
        if entry is None:
            status = "disabled" if self._synthesizer is None else "pending"
            entry = _Entry(MediaResult(status, text))
            self._entries[key] = entry
        elif entry.result.text != text:
            raise ValueError("Narration identity already belongs to different text")
        return entry

    def status(self, room_id: UUID, narration_id: UUID, text: str) -> MediaResult:
        return self._entry(room_id, narration_id, text).result

    async def prepare(self, room_id: UUID, narration_id: UUID, text: str, voice: str | None = None) -> MediaResult:
        entry = self._entry(room_id, narration_id, text)
        if entry.result.status == "disabled":
            return entry.result
        if entry.task is None:
            entry.voice = voice
            entry.task = asyncio.create_task(self._generate(entry))
        return await asyncio.shield(entry.task)

    async def _generate(self, entry: _Entry) -> MediaResult:
        try:
            if entry.voice:
                audio = await asyncio.to_thread(self._synthesizer, entry.result.text, entry.voice)
            else:
                audio = await asyncio.to_thread(self._synthesizer, entry.result.text)
            if not isinstance(audio, bytes) or not 0 < len(audio) <= MAX_AUDIO_BYTES:
                raise ValueError("Invalid audio result")
            entry.audio = audio
            entry.result = MediaResult("ready", entry.result.text)
        except Exception:
            # Provider exceptions can contain keys, response bodies, or paths.
            entry.result = MediaResult("failed", entry.result.text, "Narration unavailable")
        return entry.result

    async def stream(self, room_id: UUID, narration_id: UUID, text: str, voice: str | None = None) -> AsyncIterator[bytes]:
        """Audio for a line as it is produced. The first caller starts one upstream synthesis; every other listener
        (other windows) reads the same chunks, and once complete the line is cached like a prepared one."""
        entry = self._entry(room_id, narration_id, text)
        if entry.result.status == "disabled":
            raise KeyError("Narration is disabled")
        if entry.task is None and self._streamer is not None:
            entry.voice, entry.streamed, entry.changed = voice, True, asyncio.Condition()
            entry.task = asyncio.create_task(self._stream_generate(entry))
        elif entry.task is None:
            entry.voice = voice
            entry.task = asyncio.create_task(self._generate(entry))
        if not entry.streamed:
            await asyncio.shield(entry.task)
            if entry.audio is None:
                raise KeyError("Narration audio is unavailable")
            yield entry.audio
            return
        sent = 0
        while True:
            async with entry.changed:
                await entry.changed.wait_for(lambda: len(entry.chunks) > sent or entry.stream_ended)
                pending = entry.chunks[sent:]
                finished = entry.stream_ended
            for chunk in pending:
                yield chunk
            sent += len(pending)
            if finished and sent >= len(entry.chunks):
                return

    async def _stream_generate(self, entry: _Entry) -> MediaResult:
        loop = asyncio.get_running_loop()

        async def push(chunk: bytes) -> None:
            async with entry.changed:
                entry.chunks.append(chunk)
                entry.changed.notify_all()

        def pump() -> None:
            total = 0
            for chunk in self._streamer(entry.result.text, entry.voice):
                total += len(chunk)
                if total > MAX_AUDIO_BYTES:
                    raise ValueError("Audio too large")
                asyncio.run_coroutine_threadsafe(push(chunk), loop).result()

        try:
            await asyncio.to_thread(pump)
            if not entry.chunks:
                raise ValueError("Empty audio")
            entry.audio = b"".join(entry.chunks)
            entry.result = MediaResult("ready", entry.result.text)
        except Exception:
            # Provider exceptions can contain keys, response bodies, or paths.
            entry.result = MediaResult("failed", entry.result.text, "Narration unavailable")
        finally:
            async with entry.changed:
                entry.stream_ended = True
                entry.changed.notify_all()
        return entry.result

    def audio(self, room_id: UUID, narration_id: UUID) -> bytes:
        entry = self._entries.get((room_id, narration_id))
        if entry is None or entry.result.status != "ready" or entry.audio is None:
            raise KeyError("Narration audio is not ready")
        return entry.audio

    def record_delivery(self, room_id: UUID, narration_id: UUID, member_id: UUID,
                        event: str) -> None:
        if event not in ("started", "completed", "failed"):
            raise ValueError("Unknown narration delivery event")
        self.audio(room_id, narration_id)
        entry = self._entries[(room_id, narration_id)]
        prior = tuple(item.event for item in entry.deliveries if item.member_id == member_id)
        if event in prior:
            return
        if "completed" in prior or "failed" in prior:
            raise ValueError("Narration playback already finished")
        if event == "completed" and "started" not in prior:
            raise ValueError("Narration playback has not started")
        entry.deliveries += (Delivery(member_id, event),)

    def deliveries(self, room_id: UUID, narration_id: UUID) -> tuple[Delivery, ...]:
        entry = self._entries.get((room_id, narration_id))
        return entry.deliveries if entry is not None else ()
