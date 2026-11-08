"""Credit denominated, persistent reservations shared across all playtest rooms."""
from contextlib import closing
import json
import math
from pathlib import Path
import sqlite3
import threading
import uuid
from rehearsal.voice import ElevenSpeech


class CreditBudget:
    MAX_CAP = 30000

    def __init__(self, path, cap=0):
        if type(cap) is not int or not 0 <= cap <= self.MAX_CAP:
            raise ValueError('Credit cap must be an integer between 0 and 30000')
        self.path, self.cap = str(path), cap
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS credits(id TEXT PRIMARY KEY, operation TEXT, amount INTEGER)')
            db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value INTEGER)')
            db.execute("INSERT OR IGNORE INTO settings VALUES ('cap',?)", (cap,))
            # Existing ledger cannot acquire a larger authorization through a restart.
            stored = db.execute("SELECT value FROM settings WHERE key='cap'").fetchone()[0]
            self.cap = min(cap, stored)
        Path(path).chmod(0o600)

    def authorize_increase(self, new_cap):
        """Explicit operator authorization only; preserve every prior reservation."""
        if type(new_cap) is not int or not 0 <= new_cap <= self.MAX_CAP:
            raise ValueError('Credit cap must be an integer between 0 and 30000')
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            stored = db.execute("SELECT value FROM settings WHERE key='cap'").fetchone()[0]
            if new_cap < stored:
                raise ValueError('An authorized increase cannot lower the stored credit cap')
            db.execute("UPDATE settings SET value=? WHERE key='cap'", (new_cap,))
        self.cap = new_cap

    def status(self):
        with closing(sqlite3.connect(self.path)) as db:
            used = db.execute('SELECT COALESCE(SUM(amount),0) FROM credits').fetchone()[0]
        return {'cap': self.cap, 'reserved': used, 'remaining': max(0, self.cap - used),
                'unit': 'credits', 'note': 'Conservative reservations, not an exact provider invoice. Failed calls stay reserved.'}

    def reserve(self, operation, amount):
        if not math.isfinite(amount) or amount <= 0:
            raise ValueError('Invalid credit estimate')
        amount = math.ceil(amount)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            used = db.execute('SELECT COALESCE(SUM(amount),0) FROM credits').fetchone()[0]
            if used + amount > self.cap:
                raise ValueError('Speech credit cap reached. Typed input remains available.')
            db.execute('INSERT INTO credits VALUES (?,?,?)', (uuid.uuid4().hex, operation, amount))


class Speech:
    def __init__(self, key, directory, cap=0):
        self.directory = Path(directory)
        self.budget = CreditBudget(self.directory / 'speech-credits.sqlite', cap)
        self.lock = threading.Lock()
        # Official pricing checked 2026-11-07: Flash <=1 credit/character; STT ~330/min.
        # Use 400/min and reserve a full minute for each <=30 second recording.
        self.adapter = ElevenSpeech(key, self.budget, self.directory / 'audio',
                                    tts_per_1k=1000, stt_per_minute=400) if key else None
        self.voice = None

    def choose_voice(self):
        if not self.adapter:
            raise ValueError('ElevenLabs is not configured. Typed input remains available.')
        if not self.voice:
            voices = self.adapter.voices().get('voices', [])
            eligible = [v for v in voices if v.get('category') == 'premade' and
                        not (v.get('sharing') or {}).get('financial_rewards_enabled')]
            if not eligible:
                raise ValueError('No standard premade voice available; no paid generation attempted')
            self.voice = eligible[0]['voice_id']
        return self.voice

    def speak(self, text):
        with self.lock:
            voice = self.choose_voice()
            return self.adapter.speak(text, voice)

    def transcribe(self, path):
        with self.lock:
            if not self.adapter:
                raise ValueError('ElevenLabs is not configured')
            return self.adapter.transcribe_wav(path)
