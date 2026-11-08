"""Explicit live test using prerecorded fictional speech as real-time PCM input."""
import argparse
import asyncio
import base64
import json
import re
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid
from websockets.asyncio.client import connect
from .roundtable_benchmark import MeetingClient


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--live',action='store_true');ap.add_argument('--url',default='http://127.0.0.1:8789');args=ap.parse_args()
    if not args.live:ap.error('--live is required for paid model requests')
    people=[MeetingClient(args.url) for _ in range(3)];host=people[0]
    j=host.request('/api/roundtable/join',{'name':'Live Alex','flow':'four_rounds'});host.token=j['token']
    for m,name in zip(people[1:],('Live Morgan','Live Sam')):m.join(name,j['code'])
    out=Path('playtest/evaluations/live-audio-integration.json');report={'room':j['code'],'method':'HTTP memberships and authenticated WebSocket with real-time paced recorded fictional human PCM. No browser or human listening check.','turns':[]}
    def save():out.write_text(json.dumps(report,indent=2)+'\n')
    def stream(path,**body):
        req=urllib.request.Request(args.url+'/api/roundtable/'+path,data=json.dumps({'command_id':uuid.uuid4().hex,'voice':False,**body}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+host.token})
        with urllib.request.urlopen(req,timeout=120) as response:events=[json.loads(line) for line in response]
        report.setdefault('setup_streams',[]).append({'path':path,'events':events});save()
        assert events[-1]['type']=='done' and events[-1].get('status','done')=='done' and not any(e['type']=='error' for e in events), events[-2:]
        return events
    deadline=time.monotonic()+90
    while not host.state()['documents_ready']:
        assert time.monotonic()<deadline;time.sleep(.5)
    for m in people:m.command('ready',ready=True)
    host.command('start');stream('briefing',kind='preparation',mode='intro')
    deadline=time.monotonic()+60
    while host.state()['phase']=='preparation':
        assert time.monotonic()<deadline, 'Opening phase did not finish'
        time.sleep(.25)
    host.command('finish_discussion')
    for kind in ('it','operations','governance'):stream('briefing',kind=kind,mode='intro')
    host.command('skip_consultation')
    clips=json.loads(Path('playtest/fixtures/four-round-audio.json').read_text())['clips']
    def clip(round,step=1):return next(c for c in clips if (c['round'],c['seat'],c['step'])==(round,0,step))
    for i,m in enumerate(people):
        c=next(c for c in clips if c['round']==1 and c['seat']==i)
        m.request('/api/roundtable/command/submit_individual_decision',{'command_id':uuid.uuid4().hex,'revision':0,**c['response_fields']})
    host.command('end');stream('exercise/agent')
    async def voice(round):
        ps=host.state()['private_session'];sample=clip(round)
        pcm=subprocess.check_output(['ffmpeg','-v','error','-i','playtest/recordings/'+sample['id']+'.mp3','-f','s16le','-ar','16000','-ac','1','pipe:1'])
        row={'round':round,'sample':sample['id'],'expected_caption':sample['text'],'events':[],'input_seconds':round_float(len(pcm)/32000),'output_bytes':0,'nonzero_samples':0};report['turns'].append(row);save();started=time.perf_counter()
        url=args.url.replace('http://','ws://')+'/api/roundtable/exercise/live'
        async with connect(url,origin=args.url,max_size=1_000_000) as ws:
            await ws.send(json.dumps({'token':host.token,'revision':ps['revision']}))
            async def receive():
                async for raw in ws:
                    e=json.loads(raw)
                    if e['type']=='audio':
                        data=base64.b64decode(e.pop('pcm'));e['bytes']=len(data);row['output_bytes']+=len(data);row['nonzero_samples']+=sum(data[i:i+2]!=b'\x00\x00' for i in range(0,len(data),2));row.setdefault('first_audio_ms',round_float((time.perf_counter()-started)*1000))
                    if e['type']=='transcript' and e['role']=='human':row.setdefault('first_input_transcript_ms',round_float((time.perf_counter()-started)*1000))
                    row['events'].append(e);save()
                    if e['type']=='closed':return
            listener=asyncio.create_task(receive())
            await asyncio.sleep(4)
            for start in range(0,len(pcm),1280):
                await ws.send(pcm[start:start+1280]);await asyncio.sleep(.04)
            await ws.send(json.dumps({'type':'end_turn'}));await asyncio.sleep(8)
            await ws.send(json.dumps({'type':'stop'}));await asyncio.wait_for(listener,10)
        row['total_ms']=round_float((time.perf_counter()-started)*1000);row['output_seconds']=round_float(row['output_bytes']/48000)
        after=host.state()['private_session'];row['answer_not_auto_submitted']=not after['answers'].get('coaching_1' if round==2 else 'assessment_1');row['busy_released']=not after['busy'];row['provisional_history_saved']=bool(after.get('live_history'))
        row['human_transcript']=''.join(e['text'] for e in row['events'] if e['type']=='transcript' and e['role']=='human')
        words=lambda text:re.findall(r'[a-z0-9]+',text.lower())
        row['normalized_words_match_fixture']=words(row['human_transcript'])==words(sample['text']);save();print(json.dumps({k:v for k,v in row.items() if k not in ('events','expected_caption')}),flush=True)
    asyncio.run(voice(2))
    for step in (1,2,3):
        if step>1:stream('exercise/agent')
        host.command('private_answer',revision=host.state()['private_session']['revision'],text=clip(2,step)['text'])
    stream('exercise/agent');ps=host.state()['private_session']
    host.request('/api/roundtable/command/confirm_response_card',{'command_id':uuid.uuid4().hex,'revision':ps['revision'],**ps['card']});stream('exercise/agent')
    asyncio.run(voice(3))
    report['checks']={'two_live_sessions':len(report['turns'])==2,'no_automatic_submission':all(t['answer_not_auto_submitted'] for t in report['turns']),
        'audio_input_transcribed':all(bool(t['human_transcript']) for t in report['turns']),
        'audible_pcm_received':all(t['output_bytes']>=4800 and t['nonzero_samples']>100 for t in report['turns']),
        'locks_released':all(t['busy_released'] for t in report['turns']),
        'normalized_transcripts_match_fixtures':all(t['normalized_words_match_fixture'] for t in report['turns'])};save();print(json.dumps(report['checks']))
    assert all(report['checks'].values()), report['checks']


def round_float(x):return round(x,2)
if __name__=='__main__':main()
