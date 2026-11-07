from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import tempfile
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient
from playtest.engine import Engine, RuleError
from playtest.agents import Agents
from playtest.server import create_app
from playtest.speech import CreditBudget


class Clock:
    def __init__(self): self.now = 1000.0
    def __call__(self): return self.now


class GameTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.e = Engine(self.clock)
        self.a = self.e.join('Arjun')
        self.code = self.a['code']
        self.b = self.e.join('Jeff', self.code)
        self.c = self.e.join('Ricardo', self.code)
        self.r = self.e.rooms[self.code]
        self.tokens = [x['token'] for x in (self.a, self.b, self.c)]

    def cmd(self, player, action, **data):
        return self.e.command(player['token'], action, {'command_id': uuid.uuid4().hex, **data})

    def start(self, profile='test_3'):
        self.cmd(self.a, 'start', profile=profile)

    def advance(self, seconds):
        self.clock.now += seconds
        self.e.tick(self.r)

    def discussion(self):
        self.start()
        self.advance(8)
        self.assertEqual(self.r['phase'], 'discussion')

    def voting(self):
        self.discussion()
        self.advance(12)
        self.assertEqual(self.r['phase'], 'voting')

    def test_private_ballot_replacement_rejoin_idempotency_cutoff(self):
        self.voting()
        options = [o['id'] for o in self.r['options']]
        data = {'command_id': uuid.uuid4().hex, 'option_id': options[0]}
        self.e.command(self.a['token'], 'vote', data)
        self.e.command(self.a['token'], 'vote', data)
        with self.assertRaises(RuleError):
            self.e.command(self.a['token'], 'vote', {**data, 'option_id': options[1]})
        self.cmd(self.a, 'vote', option_id=options[1])
        self.assertIsNone(self.e.snapshot(self.b['token'])['own_vote'])
        self.assertEqual(self.e.snapshot(self.b['token'])['tally'], {})
        self.assertEqual(self.e.join('Arjun', self.code, self.a['token'])['token'], self.a['token'])
        self.assertEqual(len(self.r['members']), 3)
        self.advance(8)
        with self.assertRaises(RuleError): self.cmd(self.b, 'vote', option_id=options[0])
        self.assertEqual(len(self.r['history']), 1)
        self.assertEqual(self.r['history'][0]['option_id'], options[1])
        self.advance(1)
        self.assertEqual(len(self.r['history']), 1)

    def test_sixty_second_votes_in_real_profiles(self):
        self.start('fast_15')
        self.advance(90+30+120)
        self.assertEqual(self.r['phase'], 'voting')
        self.assertEqual(self.r['deadline'] - self.clock(), 60)
        self.cmd(self.a, 'vote', option_id=self.r['options'][0]['id'])
        self.advance(59.99)
        self.assertEqual(self.r['phase'], 'voting')
        self.advance(.01)
        self.assertEqual(self.r['phase'], 'result')

    def test_tie_only_ceo_and_tied_choices(self):
        self.voting()
        options = self.r['options']
        self.cmd(self.a, 'vote', option_id=options[0]['id'])
        self.cmd(self.b, 'vote', option_id=options[1]['id'])
        self.advance(8)
        self.assertEqual(self.r['phase'], 'tie_break')
        with self.assertRaises(RuleError): self.cmd(self.b, 'tie', option_id=options[0]['id'])
        with self.assertRaises(RuleError): self.cmd(self.a, 'tie', option_id=options[2]['id'])
        self.cmd(self.a, 'tie', option_id=options[1]['id'])
        self.assertEqual(self.r['history'][0]['reason'], 'ceo_tie_break')

    def test_zero_votes_and_tie_timeout_authored(self):
        self.voting(); self.advance(8)
        self.assertEqual(self.r['history'][0]['reason'], 'zero_votes')
        self.assertEqual(self.r['history'][0]['outcome_id'], 'containment_no_decision')
        self.advance(4+4+12)
        self.cmd(self.a, 'vote', option_id=self.r['options'][0]['id'])
        self.cmd(self.b, 'vote', option_id=self.r['options'][1]['id'])
        self.advance(8+5)
        self.assertEqual(self.r['history'][-1]['reason'], 'tie_timeout')
        self.assertEqual(self.r['history'][-1]['outcome_id'], 'communication_no_decision')

    def test_late_join_next_round_and_name_not_identity(self):
        self.discussion()
        late = self.e.join('Late', self.code)
        late_id = self.e.identities[late['token']][1]
        self.assertNotIn(late_id, self.r['electorate'])
        with self.assertRaises(RuleError): self.cmd(late, 'propose', text='An action')
        with self.assertRaises(RuleError): self.e.join(' ARJUN ', self.code)
        self.advance(12+8+4)
        self.assertIn(late_id, self.r['electorate'])
        self.assertEqual(self.r['members'][late_id]['role'], 'operations')

    def test_full_game_and_no_future_outcomes_in_snapshot(self):
        self.start()
        public = json.dumps(self.e.snapshot(self.a['token']))
        self.assertNotIn('preferred_option_id', public)
        self.assertNotIn('targeted_containment', public)
        self.assertNotIn('5000', public)
        self.advance(4+3*(4+12+8+4))
        self.assertEqual(self.r['phase'], 'ended')
        self.assertEqual(len(self.r['history']), 3)
        self.assertEqual(self.r['end_reason'], 'scenario_complete')
        self.assertTrue(all(0 <= v <= 100 for v in self.r['metrics'].values()))

    def custom(self):
        self.discussion()
        self.cmd(self.a, 'propose', text='Isolate the compromised finance device, revoke access, preserve evidence and assign Jeff to report in 30 minutes.')
        self.advance(12)
        choice = next(o for o in self.r['options'] if o['kind'] == 'custom')
        for player in (self.a, self.b, self.c): self.cmd(player, 'vote', option_id=choice['id'])
        self.advance(8)
        self.assertEqual(self.r['phase'], 'resolving')
        ticket = self.r['ai_ticket']
        self.r['jobs'][ticket] = {'id': ticket, 'kind': 'resolve', 'status': 'pending', 'round': 1}
        return ticket

    def test_custom_allowed_output_and_immutable_metrics(self):
        ticket = self.custom()
        agents = Agents(self.e)
        result = {'text': json.dumps({'outcome_id': 'targeted_containment', 'explanation': 'Scoped containment and evidence preservation.'})}
        agents.complete(self.r, ticket, result, {'node': 'containment', 'round': 1})
        self.assertEqual(self.r['history'][0]['outcome_id'], 'targeted_containment')
        self.assertEqual(self.r['metrics'], {'service_continuity':55,'data_protection':80,'public_trust':60})
        agents.close()

    def test_custom_invalid_and_late_output_cannot_apply(self):
        ticket = self.custom()
        agents = Agents(self.e)
        with self.assertRaises(RuleError):
            agents.complete(self.r, ticket, {'text':'{"outcome_id":"invented","explanation":"hi"}'}, {})
        self.assertEqual(self.r['history'], [])
        self.advance(15)
        agents.complete(self.r, ticket, {'text':'{"outcome_id":"targeted_containment","explanation":"hi"}'}, {})
        self.assertEqual(self.r['jobs'][ticket]['status'], 'discarded')
        self.assertEqual(self.r['history'], [])
        self.advance(15)
        self.assertEqual(self.r['end_reason'], 'unresolved_custom_action')
        self.assertIsNotNone(self.r['unresolved'])
        agents.close()

    def test_total_timeout_precedes_vote_and_host_cannot_vote_for_other(self):
        self.voting()
        self.r['total_deadline'] = self.r['deadline']
        self.cmd(self.a, 'vote', option_id=self.r['options'][0]['id'], member_id=self.e.identities[self.b['token']][1])
        self.assertEqual(len(self.r['votes']), 1)
        self.assertIn(self.e.identities[self.a['token']][1], self.r['votes'])
        self.advance(8)
        self.assertEqual(self.r['end_reason'], 'total_timeout')
        self.assertEqual(self.r['history'], [])

    def test_capacity_30_and_concurrent_votes(self):
        for i in range(27): self.tokens.append(self.e.join('Member '+str(i), self.code)['token'])
        with self.assertRaises(RuleError): self.e.join('Overflow', self.code)
        self.voting()
        with ThreadPoolExecutor(max_workers=30) as pool:
            list(pool.map(lambda t:self.e.command(t, 'vote', {'command_id':uuid.uuid4().hex,'option_id':self.r['options'][0]['id']}), self.tokens))
        self.assertEqual(len(self.r['votes']), 30)
        self.advance(8)
        self.assertEqual(sum(self.r['history'][0]['tally'].values()), 30)

    def test_decision_checker_never_promotes_a_proposal(self):
        self.discussion()
        self.cmd(self.a, 'propose', text='Jeff will call IT')
        result = self.cmd(self.a, 'check_decision')
        self.assertEqual(result['confirmed_decisions'], 0)
        self.assertIsNone(result['latest'])
        self.advance(20)
        result = self.cmd(self.a, 'check_decision')
        self.assertEqual(result['confirmed_decisions'], 1)
        self.assertEqual(result['latest']['reason'], 'zero_votes')

    def test_turn_permissions_and_no_duplicate_contributions(self):
        self.discussion()
        with self.assertRaises(RuleError): self.cmd(self.b, 'contribute', text='I interrupt')
        data = {'command_id':uuid.uuid4().hex,'text':'Jeff will call IT by 3 PM.'}
        self.e.command(self.a['token'], 'contribute', data)
        self.e.command(self.a['token'], 'contribute', data)
        self.assertEqual(len(self.r['contributions']), 1)
        self.cmd(self.a, 'finish')
        self.cmd(self.b, 'contribute', text='Was that confirmed?')
        self.assertEqual(self.e.snapshot(self.a['token'])['climate']['questions_recorded'], 1)


class AgentJobTests(unittest.TestCase):
    setUp = GameTests.setUp
    cmd = GameTests.cmd
    start = GameTests.start
    advance = GameTests.advance
    discussion = GameTests.discussion
    # Keep job completion checks at the actual run boundary, including event recording.
    def test_unrestricted_debrief_claims_are_rejected(self):
        self.discussion()
        self.cmd(self.a, 'end')
        provider = FakeProvider()
        agents = Agents(self.e, provider)
        model, prompt, context = agents.prompt(self.r, 'debrief', {})
        jid = uuid.uuid4().hex
        self.r['jobs'][jid] = {'id':jid,'kind':'debrief','status':'pending','error':None}
        with patch.object(provider, 'run', return_value={'text':'The minimum export count is final and recovery is complete.'}):
            agents.run(self.code, jid, model, prompt, context)
        self.assertEqual(self.r['jobs'][jid]['status'], 'failed')
        self.assertIsNone(self.r['feedback'])
        self.assertEqual(self.r['suggestions'], [])
        agents.close()

    def test_character_tracker_debrief_jobs_finish_and_failures_are_visible(self):
        self.discussion()
        self.cmd(self.a, 'contribute', text='Jeff will call IT by 3 PM.')
        cid = self.r['contributions'][0]['id']
        class Provider:
            def run(self, prompt, model='lfm3', timeout=120):
                if model == 'gliner-base':
                    return {'kind':'proposal','spans':[{'start':0,'end':4,'text':'Jeff','label':'person','raw_score':.9},
                                                       {'start':0,'end':4,'text':'FAKE','label':'person'}]}
                if 'debrief' in prompt:
                    return {'text':'{"evidence_ids":["no_decision"]}'}
                return {'text':'{"evidence_ids":["current_situation"]}'}
        agents = Agents(self.e, Provider())
        for kind in ('facilitator','it','journalist','tracker','debrief'):
            if kind == 'debrief': self.cmd(self.a, 'end')
            jid = uuid.uuid4().hex
            data = {'text':'What is known?','contribution_id':cid}
            model, prompt, context = agents.prompt(self.r, kind, data)
            self.r['jobs'][jid] = {'id':jid,'kind':kind,'status':'pending','round':self.r['round'],'error':None}
            agents.run(self.code, jid, model, prompt, context)
            self.assertEqual(self.r['jobs'][jid]['status'], 'done', self.r['jobs'][jid])
        self.assertEqual(len(self.r['suggestions']),5)
        extracted = next(s for s in self.r['suggestions'] if s['kind']=='tracker')
        self.assertEqual(len(extracted['spans']),1)
        self.assertIsNotNone(self.r['feedback'])
        jid = uuid.uuid4().hex
        self.r['jobs'][jid] = {'id':jid,'kind':'facilitator','status':'pending','error':None}
        with patch.object(agents.provider,'run',side_effect=RuntimeError('provider unavailable')):
            agents.run(self.code,jid,'lfm3','prompt',{})
        self.assertEqual(self.r['jobs'][jid]['status'],'failed')
        self.assertEqual(self.r['events'][-1]['type'],'model_failed')
        agents.close()


class BudgetTests(unittest.TestCase):
    def test_concurrent_reservations_never_exceed_cap_and_persist(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'credits.sqlite'
            budget = CreditBudget(path, 1000)
            def reserve(_):
                try: budget.reserve('test', 400); return True
                except ValueError: return False
            with ThreadPoolExecutor(max_workers=10) as pool:
                self.assertEqual(sum(pool.map(reserve, range(10))), 2)
            self.assertEqual(budget.status()['reserved'], 800)
            self.assertEqual(CreditBudget(path, 10000).status()['remaining'], 200)
            for invalid in (float('nan'), -1, 0):
                with self.assertRaises(ValueError): budget.reserve('test', invalid)
            with self.assertRaises(ValueError): CreditBudget(Path(d)/'other', 10001)


class FakeSpeech:
    def __init__(self, d):
        self.budget = CreditBudget(Path(d)/'budget', 1000)
        self.adapter = True
        self.calls = 0
        self.path = Path(d)/'test.mp3'
        self.path.write_bytes(b'ID3TEST')
    def speak(self, text):
        self.calls += 1
        self.budget.reserve('tts', len(text))
        return {'path':str(self.path), 'cached':False}
    def transcribe(self, path):
        self.budget.reserve('stt', 400)
        return {'text':'Jeff will call IT.', 'source':'speech', 'committed':False}


class FakeProvider:
    def request(self, path): return {'online':True}
    def run(self, prompt, model='lfm3', timeout=120): return {'text':'{"evidence_ids":["current_situation"]}'}


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.clock = Clock()
        self.engine = Engine(self.clock)
        self.speech = FakeSpeech(self.temp.name)
        self.client = TestClient(create_app(self.engine, FakeProvider(), self.speech))
        self.a = self.client.post('/api/join',json={'name':'Arjun'}).json()
        self.code = self.a['code']
        self.b = self.client.post('/api/join',json={'name':'Jeff','code':self.code}).json()
        self.c = self.client.post('/api/join',json={'name':'Ricardo','code':self.code}).json()
        self.auth = {'Authorization':'Bearer '+self.a['token']}
        self.room = self.engine.rooms[self.code]
    def tearDown(self):
        self.client.close()
        self.temp.cleanup()
    def command(self, action, **data):
        return self.client.post('/api/command/'+action,json={'command_id':uuid.uuid4().hex,**data},headers=self.auth)
    def test_auth_origin_documents_and_static_contract(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/api/state').status_code, 401)
        self.assertEqual(self.client.get('/api/state',headers={**self.auth,'Origin':'https://evil.test'}).status_code,403)
        self.assertEqual(self.client.get('/api/state',headers={**self.auth,'Host':'evil.test'}).status_code,403)
        docs = self.client.get('/api/documents',headers=self.auth).json()['documents']
        self.assertEqual(len(docs),3)
        other=self.client.post('/api/join',json={'name':'Other room'}).json()
        otherstate=self.client.get('/api/state',headers={'Authorization':'Bearer '+other['token']}).json()
        self.assertEqual(len(otherstate['members']),1)
        self.assertNotIn(self.code,json.dumps(otherstate))
        self.assertEqual(self.command('start',profile='test_3').status_code,200)
        self.assertEqual(self.client.post('/api/command/end',json={'command_id':uuid.uuid4().hex},headers={'Authorization':'Bearer '+self.b['token']}).status_code,403)
    def test_speech_idempotency_cancel_and_stale_audio(self):
        self.command('start',profile='test_3')
        body={'command_id':uuid.uuid4().hex,'source':'inject'}
        one=self.client.post('/api/speak',json=body,headers=self.auth)
        self.assertEqual(one.status_code,200,one.text)
        two=self.client.post('/api/speak',json=body,headers=self.auth)
        self.assertEqual(one.json(),two.json())
        self.assertEqual(self.speech.calls,1)
        sid=one.json()['id']
        self.assertEqual(self.client.get('/api/audio/'+sid,headers={'Authorization':'Bearer '+self.b['token']}).status_code,404)
        self.assertEqual(self.client.get('/api/audio/'+sid,headers=self.auth).status_code,200)
        self.client.post('/api/speech/stop',json={},headers={'Authorization':'Bearer '+self.b['token']})
        self.assertEqual(self.client.get('/api/audio/'+sid,headers=self.auth).status_code,404)
        self.assertGreater(self.speech.budget.status()['reserved'],0)
    def test_transcription_is_provisional_and_idempotent(self):
        self.command('start',profile='test_3')
        self.clock.now += 8
        headers={**self.auth,'Content-Type':'audio/wav','X-Command-ID':uuid.uuid4().hex}
        one=self.client.post('/api/transcribe',content=b'fake wav',headers=headers)
        self.assertEqual(one.status_code,200,one.text)
        self.assertFalse(one.json()['committed'])
        self.assertEqual(self.room['contributions'],[])
        self.client.post('/api/transcribe',content=b'fake wav',headers=headers)
        self.assertEqual(self.speech.budget.status()['reserved'],400)
        self.assertEqual(self.client.post('/api/transcribe',content=b'changed',headers=headers).status_code,409)


if __name__ == '__main__': unittest.main()
