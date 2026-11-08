"""Opt-in real saved speech sequence for one member; no browser or listening claim."""
import argparse,asyncio,base64,json,time,urllib.request,uuid,os
from pathlib import Path
from websockets.asyncio.client import connect
from .roundtable_benchmark import MeetingClient

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--live',action='store_true');parser.add_argument('--url',default='http://127.0.0.1:8792');args=parser.parse_args()
    if not args.live:parser.error('--live is required for paid model calls')
    host=MeetingClient(args.url);joined=host.request('/api/roundtable/join',{'name':'Solo Alex sequence','flow':'four_rounds','solo_test':True});host.token=joined['token']
    checkpoint=Path('.local/ai-playtest/solo-benchmark-membership.json');checkpoint.parent.mkdir(parents=True,exist_ok=True)
    with os.fdopen(os.open(checkpoint,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as handle:json.dump(joined,handle)
    report={'room':joined['code'],'method':'One HTTP membership, explicitly scripted decision and saved answers, real Gemini Live clip input and replies. Separate explicit card confirmation. No browser or human listening.','turns':[]};out=Path('playtest/evaluations/solo-sequence-live.json')
    def save():out.write_text(json.dumps(report,indent=2)+'\n')
    def agent(path='exercise/agent',**data):
        req=urllib.request.Request(args.url+'/api/roundtable/'+path,data=json.dumps({'command_id':uuid.uuid4().hex,'voice':False,**data}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+host.token})
        with urllib.request.urlopen(req,timeout=120) as response:events=[json.loads(line) for line in response]
        assert events[-1]['type']=='done' and events[-1].get('status','done')=='done',events[-2:]
        return events
    deadline=time.monotonic()+90
    while not host.state()['documents_ready']:
        assert time.monotonic()<deadline;time.sleep(.3)
    host.command('ready',ready=True);host.command('start');agent('briefing',kind='preparation',mode='intro')
    s=host.state();host.command('skip_test_stage',stage='opening',expected_phase=s['phase'],skip_revision=s['test_skip']['revision']);host.command('finish_discussion')
    for kind in ('it','operations','governance'):agent('briefing',kind=kind,mode='intro')
    host.command('skip_consultation')
    clips=json.loads(Path('playtest/fixtures/four-round-audio.json').read_text())['clips'];initial=next(c for c in clips if c['seat']==0 and c['round']==1)
    host.request('/api/roundtable/command/submit_individual_decision',{'command_id':uuid.uuid4().hex,'revision':0,**initial['response_fields']});host.command('end')
    async def voice(clip,revision):
        start=time.perf_counter();row={'clip':clip['id'],'phase':host.state()['private_session']['phase'],'step':clip['step'],'human_transcript':'','agent_transcript':'','output_bytes':0,'preview_bytes':0};report['turns'].append(row);save()
        ready=asyncio.Event();question=asyncio.Event();reply=asyncio.Event();complete=asyncio.Event();closed=asyncio.Event();turns=0;ident=None;error=None
        async with connect(args.url.replace('http://','ws://')+'/api/roundtable/exercise/live',origin=args.url,max_size=1_000_000) as ws:
            await ws.send(json.dumps({'token':host.token,'revision':revision,'input_mode':'recordings'}))
            async def receive():
                nonlocal ident,turns,error
                async for raw in ws:
                    event=json.loads(raw);kind=event['type']
                    if kind=='ready':ident=event['connection_id'];ready.set()
                    elif kind=='audio':row['output_bytes']+=len(base64.b64decode(event['pcm']));row.setdefault('first_audio_ms',round((time.perf_counter()-start)*1000,1))
                    elif kind=='fixture_audio':row['preview_bytes']+=len(base64.b64decode(event['pcm']))
                    elif kind=='transcript':row['human_transcript' if event['role']=='human' else 'agent_transcript']+=event['text']
                    elif kind=='fixture_complete':complete.set()
                    elif kind=='turn_complete':
                        turns+=1
                        if turns==1:question.set()
                        elif complete.is_set():reply.set()
                    elif kind=='error':error=event['message'];question.set();reply.set();complete.set()
                    elif kind=='closed':closed.set();question.set();reply.set();complete.set();return
            listener=asyncio.create_task(receive())
            try:
                await asyncio.wait_for(ready.wait(),25);await asyncio.wait_for(question.wait(),60);assert not error and not closed.is_set(),error
                await ws.send(json.dumps({'type':'play_fixture','clip_id':clip['id']}))
                await asyncio.wait_for(complete.wait(),45);await asyncio.wait_for(reply.wait(),45);assert not error and not closed.is_set(),error
                await ws.send(json.dumps({'type':'stop'}));await asyncio.wait_for(closed.wait(),5)
            finally:listener.cancel();await asyncio.gather(listener,return_exceptions=True)
        row.update(total_ms=round((time.perf_counter()-start)*1000,1),source_session=ident)
        state=host.state()['private_session'];source=next(h for h in state['live_history'] if h['id']==ident)
        assert source['completed_clips']==[clip['id']] and not state['busy']
        assert row['human_transcript'] and row['output_bytes']>4800 and row['preview_bytes']>3200
        save();print(json.dumps({k:v for k,v in row.items() if 'transcript' not in k and k!='source_session'}),flush=True);return ident
    for number,phase in [(2,'coaching'),(3,'assessment')]:
        if number==3:
            ps=host.state()['private_session'];assert ps['phase']=='card_review';report['paused_for_card_review']=True;save()
            host.request('/api/roundtable/command/confirm_response_card',{'command_id':uuid.uuid4().hex,'revision':ps['revision'],**ps['card']})
        for step in range(1,4):
            ps=host.state()['private_session']
            if not ps['prompt']:agent();ps=host.state()['private_session']
            assert ps['phase']==phase and ps['turn']==step
            clip=next(c for c in clips if c['round']==number and c['seat']==0 and c['step']==step)
            ident=asyncio.run(voice(clip,ps['revision']))
            host.command('submit_sequence_answer',revision=ps['revision'],live_session_id=ident,approved=True)
            if number==3:agent()
        if number==2:agent()
    final=host.state();ps=final['private_session'];report['checks']={'one_member':len(final['members'])==1,'six_distinct_clips_in_order':[r['clip'] for r in report['turns']]==[f'r{r}_member_1_step_{s}' for r in (2,3) for s in (1,2,3)],'six_submitted_answers':len(ps['answers'])==6,'three_scored_stages':len(ps['scores'])==3,'no_other_member_wait':final['phase']=='reunion','stopped_with_no_live_lock':not ps['busy'],'no_automatic_winner':not final['reunion']['winners'],'card_confirmation_separate':report['paused_for_card_review']};save();print(json.dumps(report['checks']),flush=True);assert all(report['checks'].values())
if __name__=='__main__':main()
