"""Explicitly generate the reusable fictional recording library, two calls at a time.

Uses the same persistent speech ledger and cache as the application. Replaying
published files never invokes this module. Failures are not automatically retried.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

from rehearsal.adapters import load_env
from rehearsal.voice import ElevenSpeech
from .speech import CreditBudget

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'playtest/fixtures/recordings.json'
OUTPUT = ROOT / 'playtest/recordings'
DATA = ROOT / '.local/ai-playtest'
MODEL = 'eleven_flash_v2_5'


def inspect_audio(path):
    raw = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                                  'format=duration:stream=codec_name', '-of', 'json', str(path)],
                                 stderr=subprocess.DEVNULL)
    metadata = json.loads(raw)
    seconds = float(metadata['format']['duration'])
    if not 0 < seconds < 30 or not any(x.get('codec_name') == 'mp3' for x in metadata.get('streams', [])):
        raise ValueError('Invalid prerecorded MP3')
    return round(seconds, 3)


def save_manifest(manifest):
    temporary = OUTPUT / 'manifest.tmp'
    temporary.write_text(json.dumps(manifest, indent=2)+'\n')
    temporary.replace(OUTPUT / 'manifest.json')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generate', action='store_true', help='Explicitly allow paid generation within the existing shared cap')
    parser.add_argument('--ids', nargs='+', help='Generate or validate only these catalog IDs; existing other assets are preserved')
    parser.add_argument('--env-file', default=str(ROOT.parent/'BoardroomCrisisSimulator/.env.local'))
    args = parser.parse_args()
    clips = json.loads(CATALOG.read_text())['clips']
    assert len({x['id'] for x in clips}) == len(clips)
    if args.ids:
        requested = set(args.ids)
        if requested - {clip['id'] for clip in clips}:
            raise ValueError('Unknown recording ID in selection')
        clips = [clip for clip in clips if clip['id'] in requested]
    for clip in clips:
        assert re.fullmatch(r'[a-z][a-z0-9_]{0,63}', clip['id'])
        assert 0 < len(clip['text']) <= 500
    total = sum(len(x['text']) for x in clips)
    if total > 4500:
        raise ValueError('This library generation is limited to 4500 characters')
    print(json.dumps({'clips': len(clips), 'characters': total, 'concurrency': 2, 'paid_generation': args.generate}), flush=True)
    if not args.generate:
        return
    if date.today() >= date(2027, 1, 1):
        raise ValueError('Review speech pricing before generating in 2027')
    if not shutil.which('ffprobe'):
        raise ValueError('Existing ffprobe is required; no generation attempted')
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA/'recordings-generation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Refuse to create a fresh ledger that could bypass the application cap.
        ledger = DATA/'speech-credits.sqlite'
        if not ledger.exists():
            raise ValueError('The shared application speech ledger must already exist')
        budget = CreditBudget(ledger, CreditBudget.MAX_CAP)
        before = budget.status()
        OUTPUT.mkdir(parents=True, exist_ok=True)
        manifest = json.loads((OUTPUT/'manifest.json').read_text()) if (OUTPUT/'manifest.json').exists() else {'clips': {}}
        pending = []
        for clip in clips:
            entry = manifest['clips'].get(clip['id'])
            dest = OUTPUT/(clip['id']+'.mp3')
            text_hash = hashlib.sha256(clip['text'].encode()).hexdigest()
            if entry and dest.exists() and entry.get('text_sha256') == text_hash and entry.get('sha256') == hashlib.sha256(dest.read_bytes()).hexdigest():
                inspect_audio(dest)
                continue
            pending.append(clip)
        if not pending:
            print(json.dumps({'already_complete': len(clips), 'budget': before}), flush=True)
            return
        if before['remaining'] is not None and sum(len(x['text']) for x in pending) > before['remaining']:
            raise ValueError('Shared speech allowance is insufficient for this batch')
        load_env(args.env_file)
        adapter = ElevenSpeech(os.environ.get('ELEVENLABS_API_KEY'), budget, DATA/'audio', tts_per_1k=1000, stt_per_minute=400)
        available = adapter.voices().get('voices', [])
        eligible = [v for v in available if v.get('category') == 'premade' and not (v.get('sharing') or {}).get('financial_rewards_enabled')]
        if not eligible:
            raise ValueError('No standard premade voices available; generation stopped')
        voices = eligible[:3]
        roles = list(dict.fromkeys(c['role'] for c in clips))
        voice_for = {role: i % len(voices) for i, role in enumerate(roles)}
        started = time.perf_counter()
        failures = []
        def generate(clip):
            start = time.perf_counter()
            index = voice_for[clip['role']]
            result = adapter.speak(clip['text'], voices[index]['voice_id'], model_id=MODEL)
            src = Path(result['path'])
            seconds = inspect_audio(src)
            dest = OUTPUT/(clip['id']+'.mp3')
            temporary = dest.with_suffix('.tmp')
            shutil.copyfile(src, temporary)
            temporary.replace(dest)
            return clip['id'], {'file': dest.name, 'duration_seconds': seconds,
                'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(),
                'text_sha256': hashlib.sha256(clip['text'].encode()).hexdigest(),
                'bytes': dest.stat().st_size, 'voice_label': 'standard voice '+chr(65+index),
                'model': MODEL, 'cached_during_generation': result['cached'],
                'generation_ms': round((time.perf_counter()-start)*1000, 1)}
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(generate, clip): clip['id'] for clip in pending}
            for future in as_completed(futures):
                ident = futures[future]
                try:
                    ident, entry = future.result()
                    manifest['clips'][ident] = entry
                    save_manifest(manifest)
                    print(json.dumps({'clip': ident, 'seconds': entry['duration_seconds'], 'cached': entry['cached_during_generation']}), flush=True)
                except Exception as exc:
                    failures.append({'clip': ident, 'error_type': type(exc).__name__})
                    print(json.dumps(failures[-1]), flush=True)
        after = budget.status()
        if 'generation' in manifest:
            manifest.setdefault('generation_history', []).append(manifest['generation'])
        manifest['generation'] = {'selected_ids': [clip['id'] for clip in clips], 'clip_count': len(manifest['clips']), 'catalog_characters': total,
            'concurrency': 2, 'distinct_standard_voices': len(voices),
            'elapsed_seconds': round(time.perf_counter()-started, 2), 'failures': failures,
            'reserved_before': before['reserved'], 'reserved_after': after['reserved'],
            'reserved_this_batch': after['reserved']-before['reserved'], 'remaining_after': after['remaining'],
            'price_checked': '2026-11-07', 'pricing_source': 'https://elevenlabs.io/pricing',
            'reservation_rate': '1 credit per character', 'model': MODEL,
            'note': 'Fictional prerecorded fixtures, not live responses. No provider calls are needed for replay.'}
        save_manifest(manifest)
        print(json.dumps(manifest['generation']), flush=True)
        if failures:
            raise SystemExit(1)


if __name__ == '__main__':
    main()
