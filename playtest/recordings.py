"""Allowlisted, prerecorded fictional speech. Playback never calls a provider."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

from .engine import require


class RecordingLibrary:
    def __init__(self, catalog=None, directory=None):
        base = Path(__file__).parent
        self.catalog = Path(catalog or base / 'fixtures/recordings.json')
        self.directory = Path(directory or base / 'recordings')

    def entries(self):
        data = json.loads(self.catalog.read_text()) if self.catalog.exists() else {'clips': []}
        manifest = self.directory / 'manifest.json'
        meta = json.loads(manifest.read_text()).get('clips', {}) if manifest.exists() else {}
        result = []
        for clip in data['clips']:
            ident = clip.get('id')
            if not isinstance(ident, str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}', ident):
                continue
            path = self.directory / (ident+'.mp3')
            item = {k: clip[k] for k in ('id', 'title', 'role', 'group', 'text', 'suggested_agent', 'pack_id') if k in clip}
            item.update(available=path.is_file() and ident in meta,
                        duration_seconds=meta.get(ident, {}).get('duration_seconds'),
                        prerecorded=True)
            result.append(item)
        return result

    def get(self, ident):
        item = next((c for c in self.entries() if c['id'] == ident), None)
        require(item is not None, 'Unknown recording', 404)
        require(item['available'], 'This recording has not been generated', 404)
        path = self.directory / (ident+'.mp3')
        meta = json.loads((self.directory / 'manifest.json').read_text())['clips'][ident]
        require(hashlib.sha256(path.read_bytes()).hexdigest() == meta.get('sha256'),
                'Recording integrity check failed', 409)
        require(hashlib.sha256(item['text'].encode()).hexdigest() == meta.get('text_sha256'),
                'Recording caption does not match the generated asset', 409)
        return item, path

    def wav(self, ident, target):
        _, source = self.get(ident)
        try:
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                            '-i', str(source), '-t', '29', '-ar', '16000', '-ac', '1', str(target)],
                           check=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (FileNotFoundError, subprocess.SubprocessError):
            raise ValueError('Recording conversion unavailable. Use typed text or a short WAV upload.') from None
        return target
