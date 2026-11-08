"""Explicit live check of nine recorded turns, custom ballot reset and evaluation."""
import argparse
import json
from pathlib import Path
import time
import urllib.error
import urllib.request
import uuid
from .roundtable_benchmark import MeetingClient


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true',help='Authorize automatic minutes and one text evaluation using the existing ledgers')
    parser.add_argument('--url',default='http://127.0.0.1:8788')
    args=parser.parse_args()
    if not args.live:parser.error('--live is required; this check uses real minutes and evaluation')
    people=[MeetingClient(args.url) for _ in range(3)]
    code=people[0].join('Alex extended CEO')
    for person,name in zip(people[1:],['Morgan extended participant','Sam extended participant']):person.join(name,code)
    def states():return [person.state() for person in people]
    def expect_error(person,action,status,**data):
        try:person.command(action,**data)
        except urllib.error.HTTPError as error:assert error.code==status,(action,error.code)
        else:raise AssertionError('Expected rejection for '+action)
    end=time.monotonic()+120
    while not states()[0]['documents_ready']:
        assert time.monotonic()<end,'PDF warmup timed out';time.sleep(.5)
    for person in people:person.command('ready',ready=True)
    host=people[0];report={'room':code,'method':'Three real HTTP memberships; scripted explicit contributions and votes. Real recorded bytes and elapsed clip durations. No browser control. Automatic minutes and text evaluation are live. Preparation and advisers are not called in this probe.','recordings':[],'health_before':host.request('/api/health')}
    target=Path('playtest/evaluations/extended-round.json')
    def save():target.write_text(json.dumps(report,indent=2)+'\n')
    save();host.command('start')
    end=time.monotonic()+90
    while states()[0]['phase']=='preparation':assert time.monotonic()<end;time.sleep(.25)
    catalog=host.request('/api/roundtable/recordings');assert catalog['script_length']==9
    for i,clip in enumerate(catalog['default_clip_ids']):
        person=people[i%3];snapshot=person.state();assert snapshot['speaker']==snapshot['me'] and snapshot['turn_number']==i+1
        lease=person.request('/api/roundtable/recordings/play',{'command_id':uuid.uuid4().hex,'clip_id':clip})
        request=urllib.request.Request(args.url+'/api/roundtable/recordings/audio/'+lease['id'],headers={'Authorization':'Bearer '+person.token})
        with urllib.request.urlopen(request,timeout=30) as response:content=response.read()
        until=time.monotonic()+lease['duration_seconds']+.15
        while time.monotonic()<until:states();time.sleep(.2)
        person.request('/api/roundtable/recordings/complete',{'command_id':uuid.uuid4().hex,'id':lease['id']})
        report['recordings'].append({'turn':i+1,'clip_id':clip,'bytes':len(content),'seconds':lease['duration_seconds'],'caption':lease['captions']});save()
    snapshot=host.state();assert len(snapshot['transcript'])==9 and snapshot['turn_number']==10
    report['speech_reservations_after_replay']=host.request('/api/health')['speech']['reserved']
    report['shared_speech_reservations_unchanged_during_replay']=(report['speech_reservations_after_replay']==report['health_before']['speech']['reserved'])
    host.command('finish_discussion');assert host.state()['phase']=='consultation'
    host.command('skip_consultation');snapshot=host.state();decision=snapshot['decisions'][0]['id']
    guide=host.request('/api/roundtable/decision-prompt')
    request=urllib.request.Request(args.url+guide['audio_url'],headers={'Authorization':'Bearer '+host.token})
    with urllib.request.urlopen(request,timeout=30) as response:report['guide_bytes']=len(response.read())
    host.request('/api/roundtable/decision-prompt/stop',{})
    host.command('vote_option',decision_id=decision,option_id='technical_first',ballot_version=1)
    proposal='Appoint an interim coordinator, authorize the approved paper appointment process, and ask IT to verify backup usability, recovery dependencies and a restoration estimate. Return to the board for a recorded review before making any restoration promise; issue a factual update with the next update time.'
    data={'decision_id':decision,'title':'Continuity with a board review','proposal':proposal,'ballot_version':1}
    expect_error(people[2],'add_custom_option',409,**data)
    people[2].command('add_custom_option',**data,acknowledge_reset=True)
    ballot=host.state()['decisions'][0];assert ballot['ballot_count']==0 and ballot['ballot_version']==2
    custom=ballot['options'][-1]['id']
    expect_error(host,'vote_option',409,decision_id=decision,option_id=custom,ballot_version=1)
    expect_error(people[2],'vote_option',403,decision_id=decision,option_id=custom,ballot_version=2)
    for person,option in zip(people,[custom,custom,'technical_first']):person.command('vote_option',decision_id=decision,option_id=option,ballot_version=2)
    host.command('commit_decision',decision_id=decision,ballot_version=2)
    committed=host.state()['decisions'][0]
    assert committed['option_id']==custom and committed['proposal']==proposal and committed['option_kind']=='custom'
    report['decision']=committed;report['guide']=guide;save()
    start=time.perf_counter();evaluation={'text':'','events':[]}
    request=urllib.request.Request(args.url+'/api/roundtable/briefing',data=json.dumps({'command_id':uuid.uuid4().hex,'kind':'evaluation','mode':'intro','voice':False,'decision_id':decision}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+host.token})
    with urllib.request.urlopen(request,timeout=90) as response:
        for line in response:
            event=json.loads(line);evaluation['events'].append(event['type'])
            if event['type']=='text':evaluation.setdefault('first_text_ms',round((time.perf_counter()-start)*1000,1));evaluation['text']+=event['text']
            if event['type']=='sources':evaluation['citations']=event['citations']
            if event['type']=='done':evaluation['result']=event
    evaluation['total_ms']=round((time.perf_counter()-start)*1000,1)
    report['evaluation']=evaluation;save()
    assert evaluation.get('result',{}).get('status')=='done' and evaluation['text']
    host.command('end');snapshot=host.state()
    report['record']={key:snapshot[key] for key in ('phase','transcript','summary','decisions','history','jobs')}
    report['health_after']=host.request('/api/health')
    report['checks']={'nine_recorded_turns':True,'shared_speech_reservations_unchanged_during_replay':report['shared_speech_reservations_unchanged_during_replay'],'custom_requires_explicit_vote_reset':True,'stale_ballot_rejected':True,'first_votes_in_order':True,'custom_wins_two_to_one':True,'canonical_custom_proposal_committed':True,'live_evaluation_completed':True}
    save();print(json.dumps(report['checks']))


if __name__=='__main__':main()
