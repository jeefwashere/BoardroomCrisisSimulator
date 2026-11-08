"""Complete X12 route flow with real assets and a controlled clock, fake inference."""
import json
import tempfile
import unittest
import uuid
from fastapi.testclient import TestClient
from playtest.server import create_app
from playtest.roundtable import Roundtable
from playtest.tests.test_roundtable_api import MemoryFixture
from playtest.tests.test_preparation_stream import StreamingProvider, StreamingSpeech


class GuidedRoundTests(unittest.TestCase):
    def test_complete_round_with_consultation_boundary_and_explicit_ballots(self):
        with tempfile.TemporaryDirectory() as folder:
            now=[1000.]
            engine=Roundtable(clock=lambda:now[0])
            memory=MemoryFixture(folder)
            memory.documents[0]['id']='T01'
            status=memory.status
            memory.status=lambda:{**status(),'demo_document_ids':['T01']}
            speech=StreamingSpeech();provider=StreamingProvider(speech)
            app=create_app(roundtable=engine,memory=memory,speech=speech,provider=provider)
            with TestClient(app) as client:
                seats=[]
                def call(path,who=0,data=None):
                    headers={'Authorization':'Bearer '+seats[who]['token']} if seats else {}
                    response=(client.get if data is None else client.post)('/api/roundtable/'+path,headers=headers,**({} if data is None else {'json':data}))
                    self.assertEqual(response.status_code,200,response.text)
                    return response
                def command(action,who=0,**data):return call('command/'+action,who,{'command_id':uuid.uuid4().hex,**data}).json()
                seats.append(client.post('/api/roundtable/join',json={'name':'CEO'}).json())
                for name in ['B','C']:seats.append(client.post('/api/roundtable/join',json={'name':name,'code':seats[0]['code']}).json())
                for who in range(3):command('ready',who,ready=True)
                self.assertEqual(command('start')['phase'],'preparation')
                now[0]+=30
                self.assertEqual(call('state').json()['phase'],'discussion')
                clips=call('recordings').json()['default_clip_ids']
                for turn,clip in enumerate(clips):
                    who=turn%3
                    lease=call('recordings/play',who,{'command_id':uuid.uuid4().hex,'clip_id':clip}).json()
                    self.assertTrue(call('recordings/audio/'+lease['id'],who).content)
                    now[0]+=lease['duration_seconds']+.1
                    call('recordings/complete',who,{'command_id':uuid.uuid4().hex,'id':lease['id']})
                snapshot=command('finish_discussion')
                self.assertEqual(snapshot['phase'],'consultation')
                self.assertEqual(snapshot['deadline']-snapshot['server_time'],60)
                result=call('briefing',data={'command_id':uuid.uuid4().hex,'kind':'facilitator','voice':False})
                self.assertEqual(json.loads(result.text.splitlines()[-1])['status'],'done')
                now[0]+=59
                self.assertEqual(call('state').json()['phase'],'consultation')
                now[0]+=1
                snapshot=call('state').json()
                self.assertEqual(snapshot['phase'],'decision')
                decision=snapshot['decisions'][0]
                self.assertEqual(decision['ballot_count'],0)
                self.assertEqual(decision['mode'],'fixed_choice')
                prompt=call('decision-prompt').json()
                self.assertTrue(call('decision-prompt/audio').content)
                call('decision-prompt/stop',data={})
                self.assertEqual(len(call('state').json()['transcript']),9)
                out_of_turn=client.post('/api/roundtable/command/vote_option',headers={'Authorization':'Bearer '+seats[2]['token']},json={'command_id':uuid.uuid4().hex,'decision_id':decision['id'],'option_id':'controlled_continuity'})
                self.assertEqual(out_of_turn.status_code,403)
                self.assertEqual(call('state').json()['decisions'][0]['ballot_count'],0)
                command('vote_option',decision_id=decision['id'],option_id='technical_first',ballot_version=1)
                proposal='Appoint an interim coordinator and approve paper appointments while IT verifies recovery; require a board review before a restoration promise.'
                updated=command('add_custom_option',0,decision_id=decision['id'],title='Verified continuity',proposal=proposal,ballot_version=1,acknowledge_reset=True)['decisions'][0]
                self.assertEqual(updated['ballot_count'],0)
                custom=updated['options'][-1]['id']
                for who,option in enumerate([custom,custom,'technical_first']):
                    before=call('state',who).json()
                    self.assertEqual(before['decisions'][0]['next_voter'],before['me'])
                    command('vote_option',who,decision_id=decision['id'],option_id=option,ballot_version=2)
                committed=command('commit_decision',decision_id=decision['id'],ballot_version=2)['decisions'][0]
                self.assertEqual(committed['option_id'],custom)
                self.assertEqual(committed['option_kind'],'custom')
                self.assertEqual(committed['proposal'],proposal)
                self.assertEqual(committed['tally'][custom],2)
                result=call('briefing',data={'command_id':uuid.uuid4().hex,'kind':'evaluation','decision_id':decision['id'],'voice':False})
                self.assertEqual(json.loads(result.text.splitlines()[-1])['status'],'done')
                self.assertIn(committed['proposal'],provider.prompts[-1])
                self.assertEqual(command('end')['phase'],'ended')
                self.assertEqual(prompt['clip_id'],'t01_ceo_voting_guide')
