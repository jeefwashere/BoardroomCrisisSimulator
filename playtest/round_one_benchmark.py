"""Opted in live Round 1: preparation, discussion, experts and personal contexts."""
import argparse
import base64
import json
from pathlib import Path
import time
import urllib.request
import uuid
from .roundtable_benchmark import MeetingClient


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--url',default='http://127.0.0.1:8788')
    args=parser.parse_args()
    if not args.live:parser.error('--live is required for Gemini and ElevenLabs calls')
    members=[MeetingClient(args.url) for _ in range(3)];host=members[0]
    result=host.request('/api/roundtable/join',{'name':'Round 1 CEO','flow':'board_round1'});host.token=result['token'];code=result['code']
    for member,name in zip(members[1:],['Round 1 recovery member','Round 1 community member']):member.join(name,code)
    report={'room':code,'method':'Three HTTP memberships, scripted typed discussion, real Gemma retrieval, Gemini and streamed ElevenLabs PCM. No browser listening. No private rounds or scoring.','streams':[]}
    out=Path('playtest/evaluations/round-one.json')
    def save():out.write_text(json.dumps(report,indent=2)+'\n')
    def states():return [m.state() for m in members]
    def stream(kind):
        row={'kind':kind,'text':'','audio_bytes':0};start=time.perf_counter()
        req=urllib.request.Request(args.url+'/api/roundtable/briefing',data=json.dumps({'command_id':uuid.uuid4().hex,'kind':kind,'mode':'intro','voice':True}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+host.token})
        with urllib.request.urlopen(req,timeout=120) as response:
            for line in response:
                event=json.loads(line)
                if event['type']=='text':row.setdefault('first_text_ms',round((time.perf_counter()-start)*1000,1));row['text']+=event['text']
                if event['type']=='audio':row.setdefault('first_audio_ms',round((time.perf_counter()-start)*1000,1));row['audio_bytes']+=len(base64.b64decode(event['pcm']))
                if event['type']=='sources':row['citations']=event['citations']
                if event['type']=='done':row['result']=event
                if event['type']=='error':row['error']=event['message']
        row['total_ms']=round((time.perf_counter()-start)*1000,1);row['audio_seconds']=round(row['audio_bytes']/48000,2);report['streams'].append(row);save()
        assert row.get('result',{}).get('status')=='done' and row['audio_bytes']>0,row
    deadline=time.monotonic()+120
    while not states()[0]['documents_ready']:
        assert time.monotonic()<deadline;time.sleep(.5)
    for m in members:m.command('ready',ready=True)
    host.command('start');stream('preparation')
    while states()[0]['phase']=='preparation':time.sleep(.25)
    contributions=['I propose an interim coordinator and a named review point. We should check who can authorize the paper appointment process.',
        'Backups are listed but not verified. I want IT to check usability and dependencies before we promise recovery. What should staff do meanwhile?',
        'Community members still need appointments. I want a factual update that separates the outage from unconfirmed disclosure, with a next update time.']
    for m,text in zip(members,contributions):m.command('contribute',text=text,source='typed');m.command('next_turn')
    stream('facilitator');host.command('finish_discussion')
    for kind in ('it','operations','governance'):stream(kind)
    host.command('skip_consultation')
    for i,m in enumerate(members):
        m.request('/api/roundtable/command/submit_individual_decision',{'command_id':uuid.uuid4().hex,'revision':0,
            'action':['Appoint an interim coordinator and authorize approved paper appointments.','Prioritize verification of backup usability and recovery dependencies.','Publish a factual outage update and propose a reviewed continuity arrangement.'][i],
            'reasoning':'This addresses the concern I raised while avoiding an unsupported recovery promise.',
            'evidence':'The public continuity plan and the expert perspectives, with expert suggestions treated as advice.',
            'unknowns':'Recovery time, backup usability and exact resource availability remain to be established.'})
    before=states();assert all(s['individual_decision']['member']==s['me'] for s in before)
    host.command('end');contexts=[m.request('/api/roundtable/round1-context') for m in members]
    assert len({c['individual_decision']['action'] for c in contexts})==3
    report['contexts']=contexts
    report['checks']={'opening_preparation_preserved':True,'three_experts_completed':len(contexts[0]['expert_briefings'])==3,'individual_contexts_isolated':True,'round_one_complete':host.state()['round_one_complete'],'no_points':all(c['score'] is None for c in contexts),'private_rounds_not_claimed':all(not c['private_session_implemented'] for c in contexts)}
    save();print(json.dumps(report['checks']))


if __name__=='__main__':main()
