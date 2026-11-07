"""Opt-in live preparation checks against the three participant reference packs."""
import argparse
import json
from pathlib import Path
import time
from .smoke import Client


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',default='http://127.0.0.1:8788')
    parser.add_argument('--output',default='artifacts/reference-smoke.json')
    args=parser.parse_args()
    client=Client(args.url)
    client.join('Reference checker')
    health=client.request('/api/health')
    assert health['models']['online'], 'Hosted models must be online'
    docs=client.request('/api/reference-packs')
    assert [p['id'] for p in docs['packs']]==['T01','T02','T03']
    cases=[('T01','According to BCP-4, what must IT verify before promising a restoration time?','T01-BCP:BCP-4'),
           ('T02','According to CAMPAIGN-1, are gross ticket revenues or net proceeds donated?','T02-CAMPAIGN:CAMPAIGN-1'),
           ('T03','According to ACCESS-2, does appointing a director automatically provision payment access?','T03-ACCESS:ACCESS-2')]
    results=[]
    for pack,question,expected in cases:
        jid=client.agent('preparation',pack_id=pack,text=question)
        deadline=time.monotonic()+130
        while time.monotonic()<deadline:
            state=client.request('/api/state')
            job=next(j for j in state['jobs'] if j['id']==jid)
            if job['status']!='pending':break
            time.sleep(1)
        assert job['status']=='done',job
        answer=next(x for x in state['suggestions'] if x['id']==jid)
        assert expected in answer['evidence_ids'],answer
        assert state['history']==[] and state['phase']=='lobby'
        results.append({'pack':pack,'question':question,'answer':answer['text'],'evidence':answer['evidence_ids']})
        print(pack+' preparation passed',flush=True)
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps({'ok':True,'mode':'participant_reference_only','results':results,'paid_speech_calls':0},indent=2)+'\n')


if __name__=='__main__':main()
