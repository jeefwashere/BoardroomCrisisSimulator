"""Live X12 verification: recorded participant turns, timed consultation and fixed ballot."""
import argparse
import base64
import json
from pathlib import Path
import time
import urllib.request
import uuid
import wave
from .roundtable_benchmark import MeetingClient


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--url', default='http://127.0.0.1:8788')
    args = parser.parse_args()
    if not args.live:
        parser.error('--live required: three spoken agent calls plus one minutes call using the authorized tracked providers')
    members = [MeetingClient(args.url) for _ in range(3)]
    host = members[0]
    code = host.join('Alex streaming CEO')
    for member,name in zip(members[1:],['Morgan recorded participant','Sam recorded participant']):
        member.join(name,code)
    def states(): return [m.state() for m in members]
    deadline = time.monotonic()+900
    while not host.state()['documents_ready']:
        assert time.monotonic()<deadline,'PDF reader has not warmed in 15 minutes'
        states();time.sleep(1)
    for member in members:member.command('ready',ready=True)
    state=host.state();assert len(state['documents'])==1
    report={'room':code,'documents':state['documents'],'members':3,'health_before':host.request('/api/health'),
            'cases':[],'recordings':[],'method':'Actual HTTP streaming and timed byte playback checks; browser speakers and microphone not exercised.'}
    target=Path('playtest/evaluations/guided-round.json');target.parent.mkdir(parents=True,exist_ok=True)
    def save():target.write_text(json.dumps(report,indent=2)+'\n')
    save();audio_dir=Path('.local/ai-playtest/guided-round-verification');audio_dir.mkdir(parents=True,exist_ok=True)
    def stream(kind,mode='intro',question='',**extra):
        started=time.perf_counter();case={'kind':kind,'question':question,'text':'','audio_chunks':0,'audio_bytes':0,'events':[]}
        report['cases'].append(case);save()
        request=urllib.request.Request(args.url+'/api/roundtable/briefing',
            data=json.dumps({'command_id':uuid.uuid4().hex,'mode':mode,'kind':kind,'text':question,'voice':True,**extra}).encode(),
            headers={'Content-Type':'application/json','Authorization':'Bearer '+host.token})
        with wave.open(str(audio_dir/(kind+'.wav')),'wb') as audio:
            audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(24000)
            with urllib.request.urlopen(request,timeout=120) as response:
                assert 'application/x-ndjson' in response.headers['Content-Type']
                for line in response:
                    event=json.loads(line);typ=event['type'];elapsed=round((time.perf_counter()-started)*1000,1)
                    if typ!='audio':case['events'].append({'type':typ,'client_ms':elapsed})
                    if typ=='sources':case['citations']=event['citations']
                    if typ=='text':case.setdefault('first_text_ms',elapsed);case['text']+=event['text']
                    if typ=='audio':
                        case.setdefault('first_audio_ms',elapsed);content=base64.b64decode(event['pcm']);audio.writeframesraw(content)
                        case['audio_chunks']+=1;case['audio_bytes']+=len(content)
                    if typ=='text_done':case['text_complete_ms']=elapsed
                    if typ in ('error','speech_error'):case.setdefault('errors',[]).append(event['message'])
                    if typ=='done':case['result']=event
                    if typ!='audio':save()
        case['total_ms']=round((time.perf_counter()-started)*1000,1)
        case['audio_seconds']=round(case['audio_bytes']/48000,2)
        case['audio_before_text_finished']=case.get('first_audio_ms',float('inf'))<case.get('text_complete_ms',0)
        case['criterion_pass']=(case.get('result',{}).get('status')=='done' and not case.get('errors') and case['audio_chunks']>1 and bool(case['text']) and all(c['document_id']=='T01' for c in case.get('citations',[])))
        save();assert case['criterion_pass'],f'{kind} failed; inspect report'
        return case
    host.command('start');started=time.monotonic();assert host.state()['phase']=='preparation'
    intro=stream('preparation')
    report['introduction_seconds']=intro['audio_seconds']
    report['intro_fits_opening']=intro['first_audio_ms']/1000+intro['audio_seconds']<=30
    save();assert report['intro_fits_opening'], 'Introduction playback exceeds the timed opening'
    while host.state()['phase']=='preparation':states();time.sleep(.3)
    report['preparation_phase_seconds']=round(time.monotonic()-started,2)
    state=host.state();assert state['phase']=='discussion';assert 0<state['deadline']-state['server_time']<=300
    before_clips=host.request('/api/health')['speech']['reserved']
    catalog=host.request('/api/roundtable/recordings')
    for member,clip_id in zip(members,catalog['default_clip_ids']):
        state=member.state();assert state['speaker']==state['me']
        lease=member.request('/api/roundtable/recordings/play',{'command_id':uuid.uuid4().hex,'clip_id':clip_id})
        request=urllib.request.Request(args.url+'/api/roundtable/recordings/audio/'+lease['id'],headers={'Authorization':'Bearer '+member.token})
        with urllib.request.urlopen(request,timeout=30) as response:content=response.read()
        end=time.monotonic()+lease['duration_seconds']+.2
        while time.monotonic()<end:states();time.sleep(.1)
        result=member.request('/api/roundtable/recordings/complete',{'command_id':uuid.uuid4().hex,'id':lease['id']})
        report['recordings'].append({'clip_id':clip_id,'bytes':len(content),'duration_seconds':lease['duration_seconds'],'result':result});save()
    assert host.request('/api/health')['speech']['reserved']==before_clips
    state=host.state();assert state['phase']=='discussion'
    report['discussion_ended_early_with_seconds_left']=round(state['deadline']-state['server_time'],2)
    host.command('finish_discussion');consultation_started=time.monotonic()
    state=host.state();assert state['phase']=='consultation'
    assert 0<state['deadline']-state['server_time']<=60
    for kind,question in [('facilitator','What tradeoff should we clarify between the three choices?')]:
        began=time.monotonic();before=host.state();case=stream(kind,'question',question)
        case['playback_fits_consultation']=case['first_audio_ms']/1000+case['audio_seconds']<=before['deadline']-before['server_time']
        save();assert case['playback_fits_consultation'], 'Adviser playback exceeds the consultation window'
        # Verify one chosen adviser fits the minute; three sequential replies are not guaranteed.
        until=began+case['first_audio_ms']/1000+case['audio_seconds']
        while time.monotonic()<until and host.state()['phase']=='consultation':states();time.sleep(.2)
    while host.state()['phase']=='consultation':states();time.sleep(.2)
    report['consultation_seconds']=round(time.monotonic()-consultation_started,2)
    state=host.state();assert state['phase']=='decision' and len(state['transcript'])==3
    decision=state['decisions'][0]['id'];assert state['decisions'][0]['mode']=='fixed_choice'
    prompt=host.request('/api/roundtable/decision-prompt')
    before_prompt=host.request('/api/health')['speech']['reserved']
    request=urllib.request.Request(args.url+prompt['audio_url'],headers={'Authorization':'Bearer '+host.token})
    with urllib.request.urlopen(request,timeout=30) as response:content=response.read()
    until=time.monotonic()+prompt['duration_seconds']
    while time.monotonic()<until:states();time.sleep(.2)
    host.request('/api/roundtable/decision-prompt/stop',{})
    assert host.request('/api/health')['speech']['reserved']==before_prompt
    report['decision_prompt']={**prompt,'bytes':len(content),'new_speech_reservations':0};save()
    for member,choice in zip(members,['controlled_continuity','controlled_continuity','technical_first']):
        member.command('vote_option',decision_id=decision,option_id=choice)
    host.command('commit_decision',decision_id=decision)
    assert host.state()['decisions'][0]['option_id']=='controlled_continuity'
    stream('evaluation',decision_id=decision)
    host.command('end');state=host.state();assert state['phase']=='ended' and state['decisions'][0]['status']=='approved'
    report['record']={k:state[k] for k in ('phase','transcript','summary','decisions','history','jobs')}
    report['health_after']=host.request('/api/health')
    report['checks']={'single_preloaded_pdf':True,'three_ready_members':True,'intro_before_discussion':True,'three_recorded_turns':True,'free_recorded_playback':True,'ceo_consultations':True,'early_finish':True,'one_minute_consultation':True,'recorded_decision_guidance_before_votes':True,'explicit_fixed_choice_ballots':True,'evaluation_after_commit':True}
    save();print(json.dumps([{k:c[k] for k in ('kind','first_text_ms','first_audio_ms','text_complete_ms','audio_seconds','audio_before_text_finished')} for c in report['cases']]))


if __name__=='__main__':main()
