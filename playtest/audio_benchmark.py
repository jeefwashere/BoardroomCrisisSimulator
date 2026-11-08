"""HTTP recording replay and one round, with separately opted in paid checks."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
import uuid

from .smoke import Client


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-paid-transcription', action='store_true')
    parser.add_argument('--live-models', action='store_true')
    parser.add_argument('--output', default='artifacts/audio-lab-verification.json')
    args = parser.parse_args()
    base = 'http://127.0.0.1:8788'
    clients = [Client(base) for _ in range(3)]
    host = clients[0]
    code = host.join('Audio test host')
    clients[1].join('Audio test second', code)
    clients[2].join('Audio test third', code)
    report = {'room': code, 'browser_playback_verified': False,
              'method': 'Real HTTP clients, recorded MP3 fetch and actual server timers. Not browser or microphone QA.',
              'before': host.request('/api/health'), 'replayed': [], 'transcripts': [], 'jobs': []}
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    def save():
        path.write_text(json.dumps(report, indent=2)+'\n')
    def play(client, ident):
        lease = client.request('/api/recordings/play', {'command_id': uuid.uuid4().hex, 'clip_id': ident})
        req = urllib.request.Request(base+'/api/audio/'+lease['id'], headers={'Authorization': 'Bearer '+client.token})
        with urllib.request.urlopen(req, timeout=30) as response:
            audio = response.read()
        assert lease['cached'] and lease['recorded'] and audio
        return lease, audio
    clips = host.request('/api/recordings')['clips']
    manifest = json.loads((Path(__file__).parent/'recordings/manifest.json').read_text())
    assert len(clips) >= 30 and all(c['available'] for c in clips)
    for clip in clips:
        lease, audio = play(host, clip['id'])
        assert hashlib.sha256(audio).hexdigest() == manifest['clips'][clip['id']]['sha256']
        assert lease['captions'] == clip['text']
        host.request('/api/speech/stop', {'id': lease['id']})
        report['replayed'].append(clip['id'])
    after = host.request('/api/health')
    assert after['speech'] == report['before']['speech']
    assert after['models']['budget'] == report['before']['models']['budget']
    assert not host.request('/api/state')['contributions']
    report['free_replay_verified'] = True
    save()
    print('All', len(clips), 'recordings replayed without provider reservations', flush=True)
    for client in clients:
        client.request('/api/state')
    host.command('start', profile='quick_90')
    started = time.monotonic()
    sent, voted = set(), False
    ids = ['discussion_owner', 'discussion_containment', 'discussion_public_update']
    while time.monotonic()-started < 115:
        states = [c.request('/api/state') for c in clients]
        state = states[0]
        if state['phase'] == 'discussion' and state['speaker']:
            i = next(i for i, s in enumerate(states) if s['self'] == state['speaker'])
            if i not in sent:
                if i == 0:
                    try:
                        play(clients[1], ids[1])
                        raise AssertionError('Wrong speaker accepted')
                    except urllib.error.HTTPError as exc:
                        assert exc.code == 403
                        exc.close()
                lease, audio = play(clients[i], ids[i])
                clients[i].request('/api/speech/stop', {'id': lease['id']})
                text, source = lease['captions'], 'typed'
                if args.allow_paid_transcription:
                    before_count = len(clients[i].request('/api/state')['contributions'])
                    t = time.perf_counter()
                    result = clients[i].request('/api/recordings/transcribe',
                        {'command_id': uuid.uuid4().hex, 'clip_id': ids[i]})
                    assert not result['committed']
                    assert len(clients[i].request('/api/state')['contributions']) == before_count
                    actual = result['text']
                    normalize = lambda s: re.findall(r'\w+', s.casefold().replace('3', 'three'))
                    report['transcripts'].append({'clip_id': ids[i], 'expected': text, 'actual': actual,
                        'normalized_exact': normalize(text) == normalize(actual),
                        'total_ms': round((time.perf_counter()-t)*1000, 1), 'provisional_verified': True})
                    text, source = actual, 'speech'
                clients[i].command('contribute', text=text, source=source)
                clients[i].command('finish')
                sent.add(i)
                save()
        if state['phase'] == 'voting' and not voted:
            for client in clients:
                client.command('vote', option_id=state['options'][0]['id'])
            voted = True
        if state['phase'] == 'ended':
            break
        time.sleep(.25)
    assert len(sent) == 3 and voted and len(state['history']) == 1
    report['round'] = {'elapsed_seconds': round(time.monotonic()-started, 2),
                       'contributions': state['contributions'], 'history': state['history']}
    def wait_job(jid):
        until = time.monotonic()+130
        while time.monotonic() < until:
            s = host.request('/api/state')
            j = next(j for j in s['jobs'] if j['id'] == jid)
            if j['status'] != 'pending' and j.get('timing'):
                return {'job': j, 'reply': next((x for x in s['suggestions'] if x['id'] == jid), None)}
            time.sleep(.25)
        raise TimeoutError('Agent did not finish')
    if args.live_models:
        tracker = host.agent('tracker', contribution_id=state['contributions'][0]['id'])
        report['jobs'].append(wait_job(tracker))
        def review(role):
            jid = host.agent(role, text='What consequence was recorded in decision_1?', review=True)
            return wait_job(jid)
        with ThreadPoolExecutor(max_workers=3) as pool:
            report['jobs'].extend(pool.map(review, ('facilitator', 'it', 'journalist')))
        assert all(x['job']['status'] == 'done' for x in report['jobs'])
    report['after'] = host.request('/api/health')
    report['passed'] = True
    save()
    print(json.dumps({'passed': True, 'clips': len(clips), 'transcriptions': len(report['transcripts']),
                      'live_jobs': len(report['jobs']), 'speech': report['after']['speech'],
                      'vertex': report['after']['models']['budget']}), flush=True)


if __name__ == '__main__':
    main()
