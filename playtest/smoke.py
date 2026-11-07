"""Three independent HTTP clients, real server clocks; providers are opt in."""
import argparse
import json
from pathlib import Path
import time
import urllib.request
import uuid


class Client:
    def __init__(self, base):
        self.base, self.token = base, ''
    def request(self, path, data=None):
        headers = {'Content-Type':'application/json'}
        if self.token: headers['Authorization'] = 'Bearer ' + self.token
        req = urllib.request.Request(self.base+path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
        with urllib.request.urlopen(req,timeout=50) as response: return json.load(response)
    def join(self, name, code=None):
        result = self.request('/api/join', {'name':name,'code':code})
        self.token=result['token']
        return result['code']
    def command(self, action, **data):
        return self.request('/api/command/'+action, {'command_id':uuid.uuid4().hex,**data})
    def agent(self, kind, **data):
        return self.request('/api/agent/'+kind, {'command_id':uuid.uuid4().hex,**data})['id']


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',default='http://127.0.0.1:8788')
    parser.add_argument('--live-models',action='store_true')
    parser.add_argument('--output',default='artifacts/ai-playtest-http.json')
    args=parser.parse_args()
    clients=[Client(args.url) for _ in range(3)]
    code=clients[0].join('Arjun')
    clients[1].join('Jeff',code);clients[2].join('Ricardo',code)
    assert len(clients[0].request('/api/state')['members'])==3
    if args.live_models:
        health=clients[0].request('/api/health')
        assert health['models']['online'], 'Hosted model service must be online before live tests'
    clients[0].command('start',profile='test_3')
    sent=set(); requested={}; rejoined=False
    deadline=time.monotonic()+190
    while time.monotonic()<deadline:
        states=[c.request('/api/state') for c in clients]
        s=states[0]
        marker=(s['round'],s['phase'])
        if marker not in sent:
            print(f'Round {s["round"]}: {s["phase"]}',flush=True);sent.add(marker)
        if s['phase']=='discussion':
            if args.live_models and s['round']==1 and 'facilitator' not in requested:
                requested['facilitator']=clients[0].agent('facilitator',text='What do we know about the incident?')
            for client,own in zip(clients,states):
                key=('contribution',s['round'],own['self'])
                if own['speaker']==own['self'] and key not in sent:
                    result=client.command('contribute',text='Jeff will call IT before 3 PM. Is the backup verified?',source='typed')
                    sent.add(key)
                    if args.live_models and 'tracker' not in requested:
                        requested['tracker']=client.agent('tracker',contribution_id=result['contribution_id'])
                    client.command('finish')
            if args.live_models and s['round']==1 and 'proposal' not in sent:
                clients[0].command('propose',text='Isolate the compromised finance device, revoke its credentials, preserve evidence, and assign Jeff to report scope in 30 minutes while keeping unaffected checkout running.')
                sent.add('proposal')
        if s['phase']=='voting' and ('voted',s['round']) not in sent:
            option=next(o for o in s['options'] if o['kind']==('custom' if args.live_models and s['round']==1 else 'prepared'))
            for client in clients: client.command('vote',option_id=option['id'])
            private=clients[1].request('/api/state')
            assert private['own_vote']==option['id'] and private['tally']=={}
            sent.add(('voted',s['round']))
            if not rejoined:
                # New HTTP client with the same bearer credential returns to the same seat and ballot.
                replacement=Client(args.url);replacement.token=clients[1].token
                assert replacement.request('/api/state')['self']==states[1]['self']
                clients[1]=replacement;rejoined=True
        if s['phase']=='resolution_failed':
            raise AssertionError('Live custom outcome could not be resolved: '+json.dumps(s['jobs']))
        if s['phase']=='ended':
            assert s['end_reason']=='scenario_complete',s['end_reason']
            assert len(s['history'])==3
            assert rejoined
            if args.live_models:
                requested['debrief']=clients[0].agent('debrief')
                for _ in range(90):
                    s=clients[0].request('/api/state')
                    jobs={j['id']:j for j in s['jobs']}
                    if all(jobs[j]['status']!='pending' for j in requested.values()):break
                    time.sleep(1)
                assert all(jobs[j]['status']=='done' for j in requested.values()),json.dumps(jobs)
                assert s['feedback']
                assert s['history'][0]['ai_explanation']
            out={'checked':'three independent HTTP clients, speaking, voting, consequences, rejoin and completion',
                 'live_models':args.live_models,'rounds':len(s['history']), 'end_reason':s['end_reason'],
                 'history':s['history'], 'jobs':s['jobs'], 'suggestions':s['suggestions'],
                 'no_browser_claim':True}
            path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(out,indent=2))
            print(json.dumps({'ok':True,'rounds':3,'live_models':args.live_models,'report':str(path)}),flush=True)
            return
        time.sleep(.35)
    raise TimeoutError('Playtest did not end before the smoke deadline')


if __name__=='__main__':main()
