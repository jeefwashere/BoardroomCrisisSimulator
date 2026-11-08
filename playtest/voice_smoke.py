"""Explicitly paid HTTP speech test. Uses the already configured server credit cap."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid
from .smoke import Client


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--url',default='http://127.0.0.1:8788')
    p.add_argument('--allow-paid-speech',action='store_true',required=True)
    p.add_argument('--output',default='artifacts/ai-playtest-speech.json')
    args=p.parse_args()
    clients=[Client(args.url) for _ in range(3)]
    code=clients[0].join('Voice test host')
    clients[1].join('Voice test second',code);clients[2].join('Voice test third',code)
    host=clients[0]
    before=host.request('/api/health')['speech']
    assert before['remaining']>=900, 'Require 900 conservatively reserved credits before this explicit test'
    host.command('start',profile='fast_15')
    payload={'command_id':uuid.uuid4().hex,'source':'inject'}
    generated=host.request('/api/speak',payload)
    assert host.request('/api/speak',payload)==generated
    output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
    mp3=output.with_suffix('.mp3');wav=output.with_suffix('.wav')
    req=urllib.request.Request(args.url+'/api/audio/'+generated['id'],headers={'Authorization':'Bearer '+host.token})
    with urllib.request.urlopen(req,timeout=30) as response:mp3.write_bytes(response.read())
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(mp3),'-t','6','-ar','16000','-ac','1',str(wav)],check=True)
    host.request('/api/speech/stop',{'id':generated['id']})
    print('ElevenLabs TTS returned playable MP3; duplicate request reused its receipt. Waiting for discussion.',flush=True)
    deadline=time.monotonic()+160
    while time.monotonic()<deadline:
        states=[c.request('/api/state') for c in clients]
        if states[0]['phase']=='discussion':break
        time.sleep(1)
    assert states[0]['phase']=='discussion'
    headers={'Authorization':'Bearer '+host.token,'Content-Type':'audio/wav','X-Command-ID':uuid.uuid4().hex}
    req=urllib.request.Request(args.url+'/api/transcribe',data=wav.read_bytes(),headers=headers)
    with urllib.request.urlopen(req,timeout=50) as response:transcript=json.load(response)
    assert transcript['text'].strip() and not transcript['committed']
    assert host.request('/api/state')['contributions']==[]
    host.command('contribute',text=transcript['text'],source='speech')
    assert len(host.request('/api/state')['contributions'])==1
    host.command('end')
    after=host.request('/api/health')['speech']
    report={'ok':True,'tts_bytes':mp3.stat().st_size,'captions':generated['captions'],
            'transcript':transcript,'committed_only_after_separate_command':True,
            'reserved_for_test':after['reserved']-before['reserved'],'budget':after,
            'input':'Six seconds of generated fictional audio, not a human microphone recording',
            'browser_playback_tested':False}
    output.write_text(json.dumps(report,indent=2))
    print(json.dumps({'ok':True,'reserved_for_test':report['reserved_for_test'],'transcript':transcript['text'],'report':str(output)}),flush=True)


if __name__=='__main__':main()
