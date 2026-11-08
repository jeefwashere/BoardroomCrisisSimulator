"""Opted in live four round check, with scripted human answers and real inference."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import threading
import time
import urllib.request
import urllib.error
import uuid
from .roundtable_benchmark import MeetingClient


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--adaptive',action='store_true',help='Run with predictable beta prompts disabled')
    parser.add_argument('--url',default='http://127.0.0.1:8788')
    parser.add_argument('--resume',action='store_true',help='Explicitly retry a saved local benchmark room after a failure')
    args=parser.parse_args()
    if not args.live:parser.error('--live is required for paid Gemini and ElevenLabs requests')
    people=[MeetingClient(args.url) for _ in range(3)];host=people[0]
    checkpoint=Path('.local/ai-playtest/four-round-benchmark-memberships.json')
    out=Path(__file__).parent/('evaluations/four-round-adaptive-live.json' if args.adaptive else 'evaluations/four-round-live.json');lock=threading.Lock()
    if args.resume:
        saved=json.loads(checkpoint.read_text())
        assert saved['beta_mode']==(not args.adaptive), 'Resume the same mode'
        for person,auth in zip(people,saved['memberships']):person.token=auth
        report=json.loads(out.read_text());report['explicit_resumes']=report.get('explicit_resumes',0)+1
        assert host.state()['code']==report['room']
    else:
        joined=host.request('/api/roundtable/join',{'name':'Alex beta','flow':'four_rounds'});host.token=joined['token']
        for member,name in zip(people[1:],('Morgan beta','Sam beta')):member.join(name,joined['code'])
        report={'room':joined['code'],'method':'Three HTTP memberships. Scripted typed fixture answers, real Gemma retrieval, Gemini replies and selected streamed ElevenLabs PCM. No browser or listening check. MP3 playback is covered separately with a controlled server clock.','streams':[],'beta_mode':not args.adaptive}
        host.command('set_beta_mode',enabled=not args.adaptive)
        checkpoint.parent.mkdir(parents=True,exist_ok=True)
        with os.fdopen(os.open(checkpoint,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as handle:
            json.dump({'beta_mode':not args.adaptive,'memberships':[person.token for person in people]},handle)
    clips=json.loads((Path(__file__).parent/'fixtures/four-round-audio.json').read_text())['clips']
    def save():out.write_text(json.dumps(report,indent=2)+'\n')
    def clip(who,round,step):return next(c for c in clips if (c['seat'],c['round'],c['step'])==(who,round,step))
    def stream(who,path,voice=False,**data):
        start=time.perf_counter();row={'member':who,'path':path,'request':data,'voice':voice,'text':'','audio_bytes':0}
        req=urllib.request.Request(args.url+'/api/roundtable/'+path,data=json.dumps({'command_id':uuid.uuid4().hex,'voice':voice,**data}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+people[who].token})
        try:
            with urllib.request.urlopen(req,timeout=180) as response:
                for line in response:
                    e=json.loads(line)
                    if e['type']=='text':row.setdefault('first_text_ms',round((time.perf_counter()-start)*1000,1));row['text']+=e['text']
                    if e['type']=='audio':row.setdefault('first_audio_ms',round((time.perf_counter()-start)*1000,1));row['audio_bytes']+=len(base64.b64decode(e['pcm']))
                    if e['type'] in ('error','speech_error'):row['error']=e
                    if e['type']=='done':row['result']=e
        except Exception as exc:
            row['failure']=type(exc).__name__
            if isinstance(exc,urllib.error.HTTPError):
                row['http_status']=exc.code
                try:row['error_response']=json.loads(exc.read())
                except (ValueError,UnicodeDecodeError):row['error_response']={'error':'Non JSON upstream response'}
            raise
        finally:
            row['total_ms']=round((time.perf_counter()-start)*1000,1);row['audio_seconds']=round(row['audio_bytes']/48000,2)
            with lock:
                report['streams'].append(row)
                current=people[who].state();report.setdefault('progress',{})[str(who)]={'phase':current['phase'],'private_session':current.get('private_session')}
                save()
        assert row.get('result',{}).get('status')=='done' and not row.get('error'),row
        if voice:assert row['audio_bytes']>0
        print(json.dumps({'member':who,'path':path,'ms':row['total_ms']}),flush=True)
        return row
    if not args.resume:
        deadline=time.monotonic()+120
        while not host.state()['documents_ready']:
            assert time.monotonic()<deadline;time.sleep(.5)
        report['health_before']=host.request('/api/health');save()
        for m in people:m.command('ready',ready=True)
        host.command('start');stream(0,'briefing',True,kind='preparation',mode='intro')
        while host.state()['phase']=='preparation':time.sleep(.2)
        for i,m in enumerate(people):m.command('contribute',text=clip(i,1,1)['text'],source='typed');m.command('next_turn')
        host.command('finish_discussion')
        for kind in ('it','operations','governance'):stream(0,'briefing',False,kind=kind,mode='intro')
        host.command('skip_consultation')
        for i,m in enumerate(people):m.request('/api/roundtable/command/submit_individual_decision',{'command_id':uuid.uuid4().hex,'revision':0,**clip(i,1,1)['response_fields']})
        host.command('end')
    def private(who):
        member=people[who]
        agent_id=member.state()['private_session']['agent_id']
        while True:
            ps=member.state()['private_session'];assert ps['agent_id']==agent_id
            phase,turn=ps['phase'],ps['turn']
            if phase=='assessment_done':return ps
            if phase in ('coaching','assessment'):
                if not ps['prompt']:
                    stream(who,'exercise/agent',who==0 and turn==1)
                else:
                    if phase=='coaching':assert not ps['scores']
                    member.command('private_answer',revision=ps['revision'],text=clip(who,2 if phase=='coaching' else 3,turn)['text'])
            elif phase=='card_review' and ps['card']:
                member.request('/api/roundtable/command/confirm_response_card',{'command_id':uuid.uuid4().hex,'revision':ps['revision'],**ps['card']})
            else:stream(who,'exercise/agent')
    with ThreadPoolExecutor(max_workers=3) as pool:report['private_sessions']=list(pool.map(private,range(3)))
    assert host.state()['phase']=='reunion'
    if not host.state()['reunion']['discussion']:
        for who,m in enumerate(people):
            for step in (1,2):m.command('reunion_contribute',text=clip(who,4,step)['text'])
    stream(0,'exercise/reunion',True)
    for m in people:m.command('confirm_score_review')
    host.command('announce_winner');final=host.state();report['reunion']=final['reunion']
    report['checks']={'all_four_rounds_completed':final['phase']=='ended','three_independent_private_sessions':len({p['agent_id'] for p in report['private_sessions']})==3,'nine_assessment_stages_scored':all(len(p['scores'])==3 for p in report['private_sessions']),'six_reunion_reflections':len(final['reunion']['discussion'])==6,'winner_after_member_reviews':bool(final['reunion']['winners']),'no_speech_stream_errors':all(not r.get('error') for r in report['streams'])}
    report['health_after']=host.request('/api/health');save();print(json.dumps(report['checks']))


if __name__=='__main__':main()
