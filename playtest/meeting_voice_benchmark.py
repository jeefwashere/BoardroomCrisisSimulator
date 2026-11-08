"""Explicitly paid short agent speech round trip, using the shared application ledger."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.request
import uuid
from .smoke import Client


def main():
    p=argparse.ArgumentParser();p.add_argument('--allow-paid-speech',action='store_true',required=True)
    p.add_argument('--output',default='artifacts/meeting-voice-benchmark.json');args=p.parse_args()
    base='http://127.0.0.1:8788';clients=[Client(base) for _ in range(3)];host=clients[0]
    code=host.join('Voice evaluation host');clients[1].join('Voice evaluation second',code);clients[2].join('Voice evaluation third',code)
    before=host.request('/api/health')['speech'];assert before['remaining']>=900
    jid=host.agent('facilitator',text='Which study question asks who owns the incident and continuity assumptions?')
    deadline=time.monotonic()+140
    while time.monotonic()<deadline:
        s=host.request('/api/state');job=next(j for j in s['jobs'] if j['id']==jid)
        if job['status']!='pending':break
        time.sleep(.5)
    assert job['status']=='done',job
    reply=next(x for x in s['suggestions'] if x['id']==jid)
    for c in clients:c.request('/api/state')
    host.command('start',profile='single_5')
    deadline=time.monotonic()+80
    while time.monotonic()<deadline:
        states=[c.request('/api/state') for c in clients];s=states[0]
        if s['phase']=='discussion':
            if s['speaker']:
                i=next(i for i,x in enumerate(states) if x['self']==s['speaker']);clients[i].command('finish')
            else:break
        time.sleep(.5)
    assert s['phase']=='discussion' and not s['speaker']
    # The lobby answer belongs to round zero. Request a fresh answer in this discussion.
    jid=host.agent('facilitator',text='Which study question asks who owns the incident and continuity assumptions?')
    deadline=time.monotonic()+80
    while time.monotonic()<deadline:
        s=host.request('/api/state');job=next(j for j in s['jobs'] if j['id']==jid)
        if job['status']!='pending':break
        time.sleep(.5)
    assert job['status']=='done',job
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    started=time.perf_counter();generated=host.request('/api/speak',{'command_id':uuid.uuid4().hex,'source':'suggestion','id':jid})
    req=urllib.request.Request(base+'/api/audio/'+generated['id'],headers={'Authorization':'Bearer '+host.token})
    with urllib.request.urlopen(req,timeout=30) as response:audio=response.read()
    tts_ms=round((time.perf_counter()-started)*1000,1)
    mp3=out.with_suffix('.mp3');wav=out.with_suffix('.wav');mp3.write_bytes(audio)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(mp3),'-t','29','-ar','16000','-ac','1',str(wav)],check=True)
    import wave
    with wave.open(str(wav),'rb') as f:seconds=f.getnframes()/f.getframerate()
    host.request('/api/speech/stop',{'id':generated['id']})
    started=time.perf_counter()
    req=urllib.request.Request(base+'/api/transcribe',data=wav.read_bytes(),headers={'Authorization':'Bearer '+host.token,'Content-Type':'audio/wav','X-Command-ID':uuid.uuid4().hex})
    with urllib.request.urlopen(req,timeout=60) as response:transcript=json.load(response)
    stt_ms=round((time.perf_counter()-started)*1000,1)
    assert not transcript['committed'];assert host.request('/api/state')['contributions']==[]
    host.command('contribute',text=transcript['text'],source='speech');host.command('end')
    # WER over lowercased words, ignoring punctuation. Clipped input is flagged, not hidden.
    expected=re.findall(r"\w+",generated['captions'].casefold());actual=re.findall(r"\w+",transcript['text'].casefold());dp=list(range(len(actual)+1))
    for i,a in enumerate(expected,1):
        nxt=[i]
        for j,b in enumerate(actual,1):nxt.append(min(nxt[-1]+1,dp[j]+1,dp[j-1]+(a!=b)))
        dp=nxt
    after=host.request('/api/health')['speech'];report={'tts_ms':tts_ms,'tts_cached':generated['cached'],'stt_ms':stt_ms,'audio_seconds':round(seconds,2),
        'captions':generated['captions'],'transcript':transcript['text'],'word_error_rate':round(dp[-1]/max(1,len(expected)),4),
        'audio_may_be_clipped':seconds>=29,'generated_audio_bytes':len(audio),'reserved_this_test':after['reserved']-before['reserved'],
        'budget':after,'committed_only_after_separate_command':True,'input':'Synthetic agent reply spoken by ElevenLabs, not human microphone audio.',
        'browser_playback_verified':False,'pricing_source':'https://elevenlabs.io/pricing','reservation_rates':'1 credit per TTS character, 400 per short transcription; failed requests remain reserved.'}
    out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
