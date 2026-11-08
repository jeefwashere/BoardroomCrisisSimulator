"""Opt-in ElevenLabs speech APIs; separate from the managed ElevenAgents agent.

Never called by the default demo. A caller must supply a positive budget and
verified unit prices before requesting billable speech. Charges are conservatively
reserved before requests, including failures; no automatic generation retries.
"""
import hashlib
from contextlib import closing
import json
import math
import os
from pathlib import Path
import sqlite3
import ssl
import urllib.request
import uuid
import wave


class VoiceBudget:
    def __init__(self, path, cap_usd=0):
        if not math.isfinite(cap_usd) or cap_usd < 0:
            raise ValueError("Budget must be finite and nonnegative")
        self.path, self.cap = str(path), cap_usd
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY, operation TEXT, cost REAL)")
        Path(path).chmod(0o600)

    def reserve(self, operation, estimated_usd):
        if not math.isfinite(estimated_usd) or estimated_usd <= 0 or self.cap <= 0:
            raise ValueError("Paid speech disabled: configure a positive cap and verified price")
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            used = db.execute("SELECT COALESCE(SUM(cost),0) FROM reservations").fetchone()[0]
            if used + estimated_usd > self.cap:
                raise ValueError("Voice budget exhausted; continue in text mode")
            db.execute("INSERT INTO reservations VALUES (?,?,?)", (uuid.uuid4().hex, operation, estimated_usd))


class ElevenSpeech:
    def __init__(self, key, budget, cache_dir, tts_per_1k=None, stt_per_minute=None):
        if not key:
            raise ValueError("ELEVENLABS_API_KEY is not set")
        self.key, self.budget = key, budget
        self.cache = Path(cache_dir)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.tts_rate, self.stt_rate = tts_per_1k, stt_per_minute

    def request(self, path, body=None, content_type="application/json"):
        req = urllib.request.Request("https://api.elevenlabs.io" + path, data=body,
                                     headers={"xi-api-key": self.key, "Content-Type": content_type})
        try:
            import truststore
            context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        except ImportError:
            context = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=45, context=context) as response:
            return response.read()

    def voices(self):
        return json.loads(self.request("/v2/voices?page_size=10"))

    def stream(self, approved_text, voice_id, model_id="eleven_flash_v2_5", output_format="mp3_44100_64"):
        """Yield MP3 chunks as ElevenLabs produces them (first audio in about a quarter second). Not cached here."""
        if not isinstance(approved_text, str) or not 0 < len(approved_text) <= 500:
            raise ValueError("Smoke-test speech is limited to 500 characters")
        if not voice_id or not all(c.isalnum() or c in "_-" for c in voice_id):
            raise ValueError("A voice ID from the account voice list is required")
        if self.tts_rate is None:
            raise ValueError("Set a verified TTS price before making a paid request")
        self.budget.reserve("tts", self.tts_rate * len(approved_text) / 1000)
        req = urllib.request.Request(
            "https://api.elevenlabs.io/v1/text-to-speech/" + voice_id + "/stream?output_format=" + output_format,
            data=json.dumps({"text": approved_text, "model_id": model_id}).encode(),
            headers={"xi-api-key": self.key, "Content-Type": "application/json"})
        try:
            import truststore
            context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        except ImportError:
            context = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=45, context=context) as response:
            while chunk := response.read1(16384) if hasattr(response, "read1") else response.read(16384):
                yield chunk

    def speak(self, approved_text, voice_id, model_id="eleven_flash_v2_5", output_format="mp3_44100_128"):
        if not isinstance(approved_text, str) or not 0 < len(approved_text) <= 500:
            raise ValueError("Smoke-test speech is limited to 500 characters")
        if not voice_id or not all(c.isalnum() or c in "_-" for c in voice_id):
            raise ValueError("A voice ID from the account voice list is required")
        payload = {"text": approved_text, "model_id": model_id}
        signature = hashlib.sha256((voice_id + json.dumps(payload, sort_keys=True)).encode()).hexdigest()
        target = self.cache / (signature + ".mp3")
        if target.exists():
            return {"path": str(target), "cached": True, "captions": approved_text}
        if self.tts_rate is None:
            raise ValueError("Set a verified TTS price before making a paid request")
        self.budget.reserve("tts", self.tts_rate * len(approved_text) / 1000)
        content = self.request("/v1/text-to-speech/" + voice_id + "?output_format=" + output_format, json.dumps(payload).encode())
        tmp = target.with_suffix(".tmp")
        tmp.write_bytes(content)
        tmp.replace(target)
        target.chmod(0o600)
        return {"path": str(target), "cached": False, "captions": approved_text}

    def transcribe_wav(self, path):
        path = Path(path)
        with wave.open(str(path), "rb") as audio:
            seconds = audio.getnframes() / audio.getframerate()
        if not 0.1 <= seconds <= 30 or path.stat().st_size > 10_000_000:
            raise ValueError("Use an explicitly selected WAV recording of 0.1–30 seconds, at most 10 MB")
        if self.stt_rate is None:
            raise ValueError("Set a verified transcription price before making a paid request")
        # Reserve at least a full minute to avoid underestimating minimum billing.
        self.budget.reserve("stt", self.stt_rate * max(1, seconds / 60))
        boundary = "rehearsal_" + uuid.uuid4().hex
        fields = []
        for name, value in {"model_id": "scribe_v2", "diarize": "false", "tag_audio_events": "false"}.items():
            fields.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        fields.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + path.read_bytes() + b"\r\n")
        fields.append(f"--{boundary}--\r\n".encode())
        result = json.loads(self.request("/v1/speech-to-text", b"".join(fields), "multipart/form-data; boundary=" + boundary))
        return {"text": result["text"], "source": "speech", "committed": False,
                "note": "Review text, then submit a committed contribution using the signed-in participant token."}

    def scribe_token(self):
        # Realtime streaming is a later client feature. Do not mint spend-capable
        # browser tokens in this backend-only build; it cannot meter that stream.
        raise NotImplementedError("Realtime microphone streaming is deferred; use an explicit short WAV or typed input")
