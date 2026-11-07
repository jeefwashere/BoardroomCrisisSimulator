from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import tempfile
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient
from playtest.engine import Engine, RuleError
from playtest.agents import Agents, parse_object
from playtest.server import create_app
from playtest.speech import CreditBudget


class Clock:
    def __init__(self): self.now = 1000.0
    def __call__(self): return self.now


class GameTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.e = Engine(self.clock, round_limit=3)
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


class OneRoundAndReferenceTests(unittest.TestCase):
    setUp = GameTests.setUp
    cmd = GameTests.cmd
    start = GameTests.start
    advance = GameTests.advance
    discussion = GameTests.discussion
    custom = GameTests.custom

    def test_one_round_stops_after_first_consequence_and_keeps_vote_duration(self):
        self.e.round_limit = 1
        self.start()
        self.advance(20)
        self.cmd(self.a, 'vote', option_id=self.r['options'][0]['id'])
        self.advance(12)
        self.assertEqual(self.r['phase'], 'ended')
        self.assertEqual(self.r['end_reason'], 'round_complete')
        self.assertEqual(len(self.r['history']), 1)
        self.assertEqual(self.r['node'], 'containment')
        self.assertEqual(self.e.snapshot(self.a['token'])['round_limit'], 1)
        self.assertEqual(self.r['facts']['communication_status'], 'none')
        self.advance(100)
        self.assertEqual(len(self.r['history']), 1)
        self.assertEqual(Engine().round_limit, 1)

    def test_one_round_custom_winner_ends_after_its_resolution_window(self):
        self.e.round_limit = 1
        ticket = self.custom()
        agents = Agents(self.e)
        agents.complete(self.r,ticket,{'text':'{"outcome_id":"targeted_containment","explanation":"Scoped containment."}'},{})
        self.advance(30)
        self.assertEqual(self.r['end_reason'], 'round_complete')
        self.assertEqual(len(self.r['history']), 1)
        agents.close()

    def test_model_closing_fence_does_not_discard_valid_reference_json(self):
        self.assertEqual(parse_object('{"evidence_ids":["T01-BCP:BCP-4"]}\n```'),
                         {'evidence_ids':['T01-BCP:BCP-4']})
        with self.assertRaises(ValueError):
            parse_object('This prose is not an approved response. {"evidence_ids":[]}')

    def test_reference_prompts_exclude_hidden_events_and_other_packs(self):
        agents = Agents(self.e)
        for pack,question in [('T01','Can backups promise restoration?'),('T02','Was the Bright Print invoice approved?'),('T03','Does appointment grant payroll access?')]:
            model,prompt,context=agents.prompt(self.r,'preparation',{'pack_id':pack,'text':question})
            self.assertEqual(model,'lfm3')
            self.assertLessEqual(len(prompt),4000)
            self.assertTrue(all(c['id'].startswith(pack) for c in context['evidence']))
            self.assertNotIn('CAD 1,200',prompt)
            self.assertNotIn('T02-E2',prompt)
            self.assertNotIn('Priya says she is available',prompt)
            self.assertNotIn('facilitator-only',prompt)
            first=context['evidence'][0]['id'];jid=uuid.uuid4().hex
            self.r['jobs'][jid]={'kind':'preparation','status':'pending','round':0}
            agents.complete(self.r,jid,{'text':json.dumps({'evidence_ids':[first]})},context)
            reply=self.r['suggestions'][-1]
            self.assertEqual(reply['pack_id'],pack)
            self.assertIn(context['evidence'][0]['text'],reply['text'])
        self.assertEqual(self.r['history'],[])
        self.assertEqual(self.r['phase'],'lobby')
        with self.assertRaises(RuleError):agents.prompt(self.r,'preparation',{'pack_id':'../../hidden','text':'Read answers'})
        agents.close()


class RecoveryAndFiveMinuteTests(unittest.TestCase):
    cmd = GameTests.cmd
    advance = GameTests.advance

    def setUp(self):
        GameTests.setUp(self)
        self.e.round_limit = 1
        self.e.allow_name_rejoin = True

    def test_leave_rejoin_preserves_host_role_vote_and_contribution(self):
        self.cmd(self.a, 'start')
        self.advance(45)
        self.cmd(self.a, 'contribute', text='Keep the evidence.')
        self.cmd(self.a, 'propose', text='Isolate the device.')
        self.advance(135)
        choice = self.r['options'][0]['id']
        self.cmd(self.a, 'vote', option_id=choice)
        before = self.e.snapshot(self.a['token'])
        self.r['speech'] = {'member': before['self']}
        self.cmd(self.a, 'leave')
        with self.assertRaises(RuleError): self.e.snapshot(self.a['token'])
        new = self.e.join(' ARJUN ', self.code)
        after = self.e.snapshot(new['token'])
        for key in ('self', 'host', 'electorate', 'own_vote', 'contributions', 'deadline', 'total_deadline', 'round'):
            self.assertEqual(after[key], before[key], key)
        self.assertEqual(len(after['members']), 3)
        self.assertEqual(after['members'][0]['role'], 'ceo')
        self.assertIn(before['self'], self.r['proposals'])
        self.assertIsNone(self.r['speech'])
        self.assertNotEqual(new['token'], self.a['token'])
        self.advance(60)
        self.assertEqual(self.r['history'][0]['tally'], {choice: 1})
        self.advance(60)
        self.cmd(new, 'leave')
        ended = self.e.join('Arjun', self.code)
        self.assertEqual(self.e.snapshot(ended['token'])['end_reason'], 'round_complete')

    def test_closed_tab_recovers_at_thirty_seconds_and_only_once_at_capacity(self):
        for i in range(27): self.e.join('Extra '+str(i), self.code)
        self.advance(29.999)
        with self.assertRaises(RuleError): self.e.join('Arjun', self.code)
        self.advance(.001)
        def recover(_):
            try: return self.e.join('Arjun', self.code)
            except RuleError: return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(recover, range(2)))
        self.assertEqual(sum(x is not None for x in results), 1)
        self.assertEqual(len(self.r['members']), 30)
        with self.assertRaises(RuleError): self.e.snapshot(self.a['token'])
        other = self.e.join('Arjun')
        self.assertNotEqual(other['code'], self.code)

    def test_name_recovery_is_disabled_by_default_even_when_inactive(self):
        self.e.allow_name_rejoin = False
        self.advance(31)
        with self.assertRaises(RuleError): self.e.join('Arjun', self.code)
        self.assertFalse(Engine().allow_name_rejoin)
        self.assertEqual(self.e.snapshot(self.a['token'])['self'], self.r['host'])

    def test_five_minutes_keeps_full_vote_and_ends_with_exactly_one_result(self):
        start = self.clock()
        self.cmd(self.a, 'start')
        self.assertEqual(self.r['profile'], 'single_5')
        self.assertEqual(self.r['total_deadline'], start + 300)
        self.advance(15)
        self.assertEqual(self.r['phase'], 'reading')
        self.advance(30)
        self.assertEqual(self.r['phase'], 'discussion')
        self.advance(135)
        self.assertEqual(self.r['phase'], 'voting')
        self.cmd(self.a, 'vote', option_id=self.r['options'][0]['id'])
        self.advance(59.999)
        self.assertEqual(self.r['phase'], 'voting')
        self.advance(.001)
        self.assertEqual(self.r['phase'], 'result')
        self.advance(59.999)
        self.assertEqual(self.r['phase'], 'result')
        self.advance(.001)
        self.assertEqual(self.r['phase'], 'ended')
        self.assertEqual(self.r['end_reason'], 'round_complete')
        self.assertEqual(len(self.r['history']), 1)

    def test_five_minutes_tie_and_custom_result_fit_in_deadline(self):
        self.cmd(self.a, 'start')
        self.advance(45)
        self.cmd(self.a, 'propose', text='Isolate the device.')
        self.advance(135)
        custom = self.r['options'][-1]['id']
        self.cmd(self.a, 'vote', option_id=custom)
        self.cmd(self.b, 'vote', option_id=self.r['options'][0]['id'])
        self.advance(60)
        self.assertEqual(self.r['phase'], 'tie_break')
        self.advance(14)
        self.cmd(self.a, 'tie', option_id=custom)
        self.advance(10)
        self.e.apply_outcome(self.r, 'targeted_containment', self.clock(), 'Scoped containment.')
        self.assertEqual(self.r['deadline'], self.r['total_deadline'])
        self.advance(36)
        self.assertEqual(self.r['end_reason'], 'round_complete')
        self.assertEqual(len(self.r['history']), 1)

    def test_five_minutes_late_tick_still_applies_authored_no_vote_outcome(self):
        self.cmd(self.a, 'start')
        self.advance(301)
        self.assertEqual(self.r['end_reason'], 'round_complete')
        self.assertEqual(len(self.r['history']), 1)
        self.assertEqual(self.r['history'][0]['reason'], 'zero_votes')


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
    def test_http_leave_rejoin_and_five_minute_default(self):
        self.engine.allow_name_rejoin = True
        self.assertTrue(self.client.get('/api/health').json()['test_name_rejoin'])
        self.assertEqual(self.client.post('/api/join', json={'name':'Arjun','code':self.code}).status_code, 409)
        self.assertEqual(self.command('start').status_code, 200)
        before = self.client.get('/api/state', headers=self.auth).json()
        self.assertEqual(before['total_deadline'] - before['server_time'], 300)
        self.assertEqual(self.command('leave').status_code, 200)
        self.assertEqual(self.client.get('/api/state', headers=self.auth).status_code, 401)
        rejoin = self.client.post('/api/join', json={'name':' arjun ','code':self.code})
        self.assertEqual(rejoin.status_code, 200)
        after = self.client.get('/api/state', headers={'Authorization':'Bearer '+rejoin.json()['token']}).json()
        for key in ('self','host','deadline','total_deadline'):
            self.assertEqual(after[key], before[key])
        self.assertEqual(len(after['members']), 3)

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
    def test_reference_http_is_authenticated_and_excludes_controller_source(self):
        self.assertEqual(self.client.get('/api/reference-packs').status_code,401)
        result=self.client.get('/api/reference-packs',headers=self.auth)
        self.assertEqual(result.status_code,200)
        self.assertEqual([p['id'] for p in result.json()['packs']],['T01','T02','T03'])
        self.assertNotIn('CAD 1,200',result.text)
        self.assertNotIn('T03-E1',result.text)
        self.assertEqual(self.client.get('/fixtures/revision2-controller-reference.md',headers=self.auth).status_code,404)

    def test_text_chat_authentication_isolation_and_no_game_authority(self):
        headers = {'Authorization':'Bearer '+self.b['token']}
        body = {'command_id':uuid.uuid4().hex,'text':'Test 02 can type in the lobby.',
                'member_id':self.engine.identities[self.a['token']][1]}
        self.assertEqual(self.client.post('/api/command/chat',json=body).status_code,401)
        first = self.client.post('/api/command/chat',json=body,headers=headers)
        self.assertEqual(first.status_code,200)
        self.assertEqual(self.client.post('/api/command/chat',json=body,headers=headers).json(),first.json())
        state = self.client.get('/api/state',headers=self.auth).json()
        self.assertEqual(len(state['chat']),1)
        self.assertEqual(state['chat'][0]['member'],self.engine.identities[self.b['token']][1])
        self.assertEqual(state['contributions'],[])
        self.assertEqual(state['history'],[])
        other = self.client.post('/api/join',json={'name':'Other room'}).json()
        self.assertEqual(self.client.get('/api/state',headers={'Authorization':'Bearer '+other['token']}).json()['chat'],[])
        self.command('start',profile='test_3')
        self.clock.now += 8
        self.assertEqual(self.client.post('/api/command/chat',json={'command_id':uuid.uuid4().hex,'text':'Text outside my speaking turn'},headers=headers).status_code,200)
        self.assertEqual(self.room['contributions'],[])
        self.command('end')
        self.assertEqual(self.command('chat',text='Post exercise discussion').status_code,200)
        self.assertEqual(self.command('chat',text=' ').status_code,422)
        self.assertEqual(self.command('chat',text='x'*1001).status_code,422)
        self.assertEqual(self.speech.calls,0)
        self.assertEqual(self.speech.budget.status()['reserved'],0)

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
