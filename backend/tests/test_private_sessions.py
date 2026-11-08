"""Rounds 2 and 3: private coaching and scored assessment per member, with fake providers only."""

import asyncio
from datetime import datetime
import json
import unittest
from types import SimpleNamespace
from uuid import uuid4

from backend.app import gameplay
from backend.app.facilitation import Facilitation
from backend.app.main import create_app
from backend.app.private_sessions import (CARD_RECORDED, CARD_FIELDS, COACH_UPDATE, EXAM_UPDATE, QUESTIONS, TRANSITION, TWIST,
                                          full_question)
from backend.app.rooms import Rooms
from backend.app.scenarios import ScenarioCatalog
from backend.tests import test_gameplay as fixture
from backend.tests.test_facilitation import Provider
from backend.tests import test_individual_decisions as individual

DECISIONS = individual.DECISIONS

ANSWERS = {
    (2, 1): 'COACH_ONE_{who}: I would keep coordination separate and request another approved provider.',
    (2, 2): 'COACH_TWO_{who}: I would check the delegation policy and who can authorize access.',
    (2, 3): 'COACH_THREE_{who}: The coordinator acts, paper appointments are the fallback, review at noon.',
    (3, 1): 'EXAM_ONE_{who}: First appoint an authorized coordinator because nobody owns the response yet.',
    (3, 2): 'EXAM_TWO_{who}: The delay means staff get paper instructions now while the provider is arranged.',
    (3, 3): 'EXAM_THREE_{who}: The coordinator instructs staff, falls back to paper if access fails, review at noon.',
}


class FakeVertex:
    """Answers acknowledgement, card and rubric prompts. Modes inject invalid scoring output."""

    configured = True

    def __init__(self):
        self.prompts, self.temperatures, self.mode = [], [], None
        self.gate = asyncio.Event()
        self.gate.set()

    async def json(self, prompt, timeout=30, max_output_tokens=2048, temperature=0.4):
        self.prompts.append(prompt)
        self.temperatures.append(temperature)
        await self.gate.wait()
        task, data = prompt.split('\n', 1)
        data = json.loads(data)
        if 'criteria' in data:
            if self.mode == 'fail':
                raise RuntimeError('private provider detail')
            quote = 'An invented quotation' if self.mode == 'fabricate' else data['answer'][:40]
            points = 11 if self.mode == 'range' else 7
            rows = [{'id': item['id'], 'points': points, 'evidence': quote, 'reason': 'Supported by the quote.'}
                    for item in data['criteria']]
            return {'criteria': rows[:-1] if self.mode == 'missing' else rows}
        if 'draft card' in task:
            return {'card': {field: f'Draft {field} from my plan.' for field in CARD_FIELDS}}
        return {'acknowledgement': 'You named a dependency to check? That is useful.'}


class Speech:
    """Counts paid speech requests; automated clients must never trigger one."""

    def __init__(self):
        self.prepared = []

    async def prepare(self, room_id, speech_id, text):
        self.prepared.append(text)
        return SimpleNamespace(status='ready', error=None)

    def audio(self, room_id, speech_id):
        return b'ID3 fake audio'


class PrivateSessionTests(individual.IndividualDecisionTests):
    """Reuses the Cedar room helpers; the inherited Round 1 tests are not rerun here."""

    async def asyncSetUp(self):
        self.clock = fixture.Clock()
        self.clock.now = 1000.0
        self.rooms = Rooms(ScenarioCatalog(), self.clock)
        self.provider = Provider()
        self.speech = Speech()
        self.vertex = FakeVertex()
        self.facilitation = Facilitation(self.rooms, self.provider, self.speech)
        self.app = create_app(rooms=self.rooms, facilitation_service=self.facilitation, vertex_provider=self.vertex)
        self.clients, self.ids = [], []

    async def to_private(self, submit=(0, 1, 2)):
        view = await self.to_panel()
        # Generate the expert panel so private prompts can include it.
        await self.clients[0].get(self.path + '/facilitation')
        for _ in range(100):
            panel = (await self.clients[0].get(self.path + '/facilitation')).json()['expert_panel']
            if panel and panel['status'] == 'ready':
                break
            await asyncio.sleep(0.01)
        view = await self.action(0, view, 'skip-phase')
        self.assertEqual(view['phase'], 'individual_decision')
        for index in submit:
            view = await self.decide(index, view, DECISIONS[index])
        if len(submit) < 3:
            view = await self.action(0, view, 'skip-phase')
        self.assertEqual(view['phase'], 'private_session')
        return view

    async def session(self, who=0, expected=200):
        response = await self.clients[who].get(self.path + '/private-session')
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    async def post(self, who, route, expected=200, command_id=None, **fields):
        response = await self.clients[who].post(self.path + '/private-session/' + route,
                                                json={'command_id': command_id or str(uuid4()), **fields})
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    async def settle(self, who=0):
        for _ in range(200):
            body = await self.session(who)
            if not body['busy']:
                return body
            await asyncio.sleep(0.01)
        self.fail('Private job did not finish')

    async def answer(self, who, round_, step, used_clip=False):
        body = await self.session(who)
        self.assertEqual((body['expecting']['round'], body['expecting']['step']), (round_, step))
        text = ANSWERS[(round_, step)].format(who=who)
        posted = await self.post(who, 'answer', text=text, used_clip=used_clip)
        self.assertIsNone(posted['expecting'])
        return text, await self.settle(who)

    async def coach(self, who):
        for step in (1, 2, 3):
            _, body = await self.answer(who, 2, step)
        # The coach records the card live and Round 3 begins without a card review screen.
        self.assertEqual((body['stage'], body['card']['status']), ('assessment', 'confirmed'))
        return body

    async def complete(self, who):
        await self.coach(who)
        for step in (1, 2, 3):
            _, body = await self.answer(who, 3, step)
        self.assertEqual(body['stage'], 'complete')
        return body

    async def test_phase_transition_progress_and_gates(self):
        view = await self.to_panel()
        await self.session(0, expected=409)
        decision = await self.action(0, view, 'skip-phase')
        early = await self.clients[0].get(self.path + '/private-session')
        self.assertEqual((early.status_code, early.json()['detail']['code']), (409, 'not_private_session'))
        self.assertTrue(decision['game']['private_rounds'])
        self.assertIsNone(decision['game']['private_progress'])
        for index in range(3):
            view = await self.decide(index, decision, DECISIONS[index])
        self.assertEqual(view['phase'], 'private_session')
        game = view['game']
        self.assertEqual(game['private_progress'], [
            {'member_id': member, 'display_name': f'Player {index}',
             'role_name': ('CEO', 'IT recovery lead', 'Communications lead')[index], 'stage': 'not_started'}
            for index, member in enumerate(self.ids)])
        remaining = (datetime.fromisoformat(game['phase_deadline'])
                     - datetime.fromisoformat(game['server_time'])).total_seconds()
        self.assertGreater(remaining, 1490)
        self.assertGreaterEqual(datetime.fromisoformat(game['session_deadline']),
                                datetime.fromisoformat(game['phase_deadline']))
        for index in range(3):
            actions = (await self.view(index))['game']['allowed_actions']
            self.assertIn('private_session', actions)
            self.assertNotIn('submit_decision', actions)
        self.assertIn('skip_phase', (await self.view(0))['game']['allowed_actions'])
        self.assertEqual((await self.view(1))['game']['individual_decisions']['self']['text'], DECISIONS[1])
        # A late joiner is not part of this electorate and has no branch.
        late = await self.client()
        joined = await late.post('/api/rooms/join', json=fixture.command(
            room_code=self.code, display_name='Late', role_id='operations'))
        self.assertEqual(joined.status_code, 200, joined.text)
        response = await late.get(self.path + '/private-session')
        self.assertEqual((response.status_code, response.json()['detail']['code']), (403, 'not_eligible'))

    async def test_concurrent_first_reads_create_one_branch_with_twist_and_question(self):
        await self.to_private()
        bodies = [response.json() for response in await asyncio.gather(
            *(self.clients[0].get(self.path + '/private-session') for _ in range(6)))]
        self.assertEqual(len({json.dumps(body['messages']) for body in bodies}), 1)
        body = bodies[0]
        self.assertEqual(len(self.facilitation.private.branches), 1)
        self.assertEqual([(item['kind'], item['text']) for item in body['messages']],
                         [('twist', TWIST), ('question', QUESTIONS[2][0])])
        self.assertTrue(all(item['author'] == 'agent' and item['source'] == 'canonical' and item['speech_id']
                            for item in body['messages']))
        self.assertEqual((body['round'], body['stage'], body['agent']),
                         (2, 'coaching', {'label': 'Crisis coach', 'role': 'coach'}))
        self.assertEqual(body['expecting'], {'round': 2, 'step': 1, 'question': full_question(2, 1)})
        self.assertEqual(body['decision_text'], DECISIONS[0])
        self.assertEqual(body['clip']['clip_id'], 'r2_member_1_step_1')
        self.assertEqual(body['clip']['audio_url'], '/api/recordings/r2_member_1_step_1/audio')
        self.assertGreater(body['clip']['duration_seconds'], 0)
        self.assertTrue(body['clip']['text'])
        audio = await self.clients[0].get(body['clip']['audio_url'])
        self.assertEqual((audio.status_code, audio.headers['content-type']), (200, 'audio/mpeg'))
        self.assertEqual((await self.session(1))['clip']['clip_id'], 'r2_member_2_step_1')
        self.assertEqual(body['assessment'], {'stages': [
            {'step': 1, 'max': 30, 'points': None, 'status': 'waiting'},
            {'step': 2, 'max': 40, 'points': None, 'status': 'waiting'},
            {'step': 3, 'max': 30, 'points': None, 'status': 'waiting'}], 'total': None, 'max': 100, 'feedback': None})
        self.assertEqual((body['busy'], body['card'], body['retryable']), (False, None, False))
        stages = {item['member_id']: item['stage'] for item in (await self.view())['game']['private_progress']}
        self.assertEqual([stages[member] for member in self.ids], ['coaching', 'coaching', 'not_started'])

    async def test_full_branch_coaching_card_and_scored_assessment(self):
        await self.to_private()
        await self.session(0)
        # Answers are idempotent by command_id; a different intent conflicts.
        command_id = str(uuid4())
        text = ANSWERS[(2, 1)].format(who=0)
        self.vertex.gate.clear()
        first = await self.post(0, 'answer', command_id=command_id, text=text, used_clip=True)
        self.assertTrue(first['busy'])
        self.assertEqual((first['messages'][-1]['kind'], first['messages'][-1]['status']), ('ack', 'pending'))
        busy = await self.clients[0].post(self.path + '/private-session/answer',
                                          json={'command_id': str(uuid4()), 'text': 'While busy', 'used_clip': False})
        self.assertEqual((busy.status_code, busy.json()['detail']['code']), (409, 'agent_busy'))
        self.vertex.gate.set()
        body = await self.settle()
        again = await self.post(0, 'answer', command_id=command_id, text=text, used_clip=True)
        self.assertEqual(again['messages'], body['messages'])
        conflict = await self.clients[0].post(self.path + '/private-session/answer',
                                              json={'command_id': command_id, 'text': 'Different', 'used_clip': False})
        self.assertEqual(conflict.json()['detail']['code'], 'command_conflict')
        self.assertEqual([(item['author'], item['kind']) for item in body['messages'][2:]],
                         [('member', 'answer'), ('agent', 'ack'), ('agent', 'update'), ('agent', 'question')])
        ack = body['messages'][3]
        self.assertEqual((ack['source'], ack['status']), ('vertex', 'ready'))
        self.assertNotIn('?', ack['text'])
        self.assertEqual(body['messages'][4]['text'], COACH_UPDATE)
        self.assertEqual(body['expecting']['question'], full_question(2, 2))
        self.assertEqual(body['clip']['clip_id'], 'r2_member_1_step_2')
        for step in (2, 3):
            _, body = await self.answer(0, 2, step)
        draft = {field: f'Draft {field} from my plan.' for field in CARD_FIELDS}
        self.assertEqual(body['card'], {'status': 'confirmed', 'fields': draft})
        self.assertEqual(body['assessment']['total'], None)
        confirmed = body
        self.assertEqual((confirmed['round'], confirmed['stage'], confirmed['agent']['role']), (3, 'assessment', 'examiner'))
        self.assertEqual([(item['kind'], item['text']) for item in confirmed['messages'][-3:]],
                         [('update', CARD_RECORDED), ('transition', TRANSITION), ('question', QUESTIONS[3][0])])
        self.assertEqual(confirmed['messages'][-1]['text'], QUESTIONS[3][0])
        self.assertEqual(confirmed['clip']['clip_id'], 'r3_member_1_step_1')
        # The old card review command no longer applies.
        await self.post(0, 'card', expected=409, fields={field: 'Edited.' for field in CARD_FIELDS})
        expected_totals = (21, 49, 70)
        for step in (1, 2, 3):
            answer = ANSWERS[(3, step)].format(who=0)
            pending = await self.post(0, 'answer', text=answer, used_clip=False)
            self.assertEqual(pending['assessment']['stages'][step - 1]['status'], 'scoring')
            body = await self.settle()
            stage = body['assessment']['stages'][step - 1]
            self.assertEqual((stage['status'], stage['points']), ('scored', (21, 28, 21)[step - 1]))
            self.assertEqual(body['assessment']['total'], expected_totals[step - 1])
            results = [item for item in body['messages'] if item['kind'] == 'result']
            self.assertEqual(len(results), step)
            self.assertEqual((results[-1]['source'], results[-1]['status']), ('vertex', 'ready'))
            self.assertIn(f"Stage {step}: {stage['points']} of {stage['max']} points.", results[-1]['text'])
            if step == 1:
                self.assertEqual([item['text'] for item in body['messages'][-2:]], [EXAM_UPDATE, QUESTIONS[3][1]])
                self.assertEqual(body['expecting']['question'], full_question(3, 2))
            if step < 3:
                self.assertIsNone(body['assessment']['feedback'])
                self.assertEqual(body['stage'], 'assessment')
        self.assertEqual((body['stage'], body['expecting'], body['clip']), ('complete', None, None))
        self.assertIn('70 of 100', body['messages'][-1]['text'])
        feedback = body['assessment']['feedback']
        self.assertEqual([item['step'] for item in feedback], [1, 2, 3])
        self.assertEqual([len(item['criteria']) for item in feedback], [3, 4, 3])
        first = feedback[0]['criteria'][0]
        self.assertEqual((first['id'], first['label'], first['max'], first['points']),
                         ('facts_uncertainty', 'Accurate use of facts and uncertainty', 10, 7))
        self.assertIn(first['quote'], ANSWERS[(3, 1)].format(who=0))
        self.assertTrue(first['reason'])
        self.assertTrue(all(value == 0 for value in self.vertex.temperatures))
        grade_prompts = [prompt for prompt in self.vertex.prompts if '"criteria"' in prompt]
        self.assertEqual(len(grade_prompts), 3)
        # The examiner grades the Round 3 answer, not coaching history.
        self.assertNotIn('COACH_ONE_0', grade_prompts[0])
        self.assertIn(EXAM_UPDATE, grade_prompts[1])
        stages = {item['member_id']: item['stage'] for item in (await self.view())['game']['private_progress']}
        self.assertEqual(stages[self.ids[0]], 'complete')
        self.assertEqual((await self.view())['phase'], 'private_session')
        await self.post(0, 'answer', expected=409, text='Already complete')
        await self.post(0, 'retry', expected=409)
        self.assertEqual(self.speech.prepared, [])

    async def test_invalid_scoring_keeps_answer_fails_and_retries(self):
        await self.to_private()
        await self.coach(0)
        answer = ANSWERS[(3, 1)].format(who=0)
        for mode in ('fabricate', 'range', 'missing', 'fail'):
            self.vertex.mode = mode
            if mode == 'fabricate':
                await self.post(0, 'answer', text=answer)
            else:
                retried = await self.post(0, 'retry')
                self.assertTrue(retried['busy'])
            body = await self.settle()
            self.assertTrue(body['retryable'], mode)
            self.assertEqual(body['assessment']['stages'][0], {'step': 1, 'max': 30, 'points': None, 'status': 'failed'})
            self.assertIsNone(body['assessment']['total'])
            self.assertIsNone(body['expecting'])
            self.assertEqual([item['text'] for item in body['messages'] if item['kind'] == 'answer'][-1], answer)
            self.assertEqual(body['messages'][-1]['status'], 'failed')
            self.assertNotIn('private provider', json.dumps(body))
        await self.post(0, 'answer', expected=409, text='Cannot answer while failed')
        self.vertex.mode = None
        await self.post(0, 'retry')
        body = await self.settle()
        self.assertFalse(body['retryable'])
        self.assertEqual(body['assessment']['stages'][0]['points'], 21)
        self.assertEqual(body['expecting']['step'], 2)
        self.assertIsNone(body['assessment']['feedback'])

    async def test_private_isolation_between_members(self):
        await self.to_private()
        await self.answer(0, 2, 1)
        prompts_a = list(self.vertex.prompts)
        self.assertTrue(prompts_a)
        for prompt in prompts_a:
            self.assertIn(DECISIONS[0], prompt)
            self.assertIn('COACH_ONE_0', prompt)
            self.assertNotIn(DECISIONS[1], prompt)
            self.assertNotIn(DECISIONS[2], prompt)
            # Grounding: Round 1 discussion, the expert panel and the public report.
            self.assertIn('Speaking turn 1', prompt)
            self.assertIn('Hosted advisory reply.', prompt)
            self.assertIn('Cedar Bridge', prompt)
        self.vertex.prompts.clear()
        other = await self.session(1)
        text = json.dumps(other)
        self.assertNotIn('COACH_ONE_0', text)
        self.assertNotIn(DECISIONS[0], text)
        self.assertEqual(len(other['messages']), 2)
        await self.answer(1, 2, 1)
        for prompt in self.vertex.prompts:
            self.assertNotIn('COACH_ONE_0', prompt)
            self.assertNotIn(DECISIONS[0], prompt)
            self.assertIn('COACH_ONE_1', prompt)
        # Speech IDs resolve only within the caller's own branch; preparing is explicit.
        own = (await self.session(0))['messages'][-1]['speech_id']
        denied = await self.clients[1].post(f'{self.path}/facilitation/speech/{own}/prepare')
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(self.speech.prepared, [])
        allowed = await self.clients[0].post(f'{self.path}/facilitation/speech/{own}/prepare')
        self.assertEqual(allowed.json(), {'status': 'ready', 'error': None})
        self.assertEqual(len(self.speech.prepared), 1)
        audio = await self.clients[0].get(f'{self.path}/facilitation/speech/{own}/audio')
        self.assertEqual(audio.status_code, 200)
        self.assertEqual((await self.clients[1].get(f'{self.path}/facilitation/speech/{own}/audio')).status_code, 404)
        # Nothing private leaks into the shared room view or contributions.
        shared = json.dumps(await self.view(2)) + (await self.clients[2].get(self.path + '/contributions')).text
        self.assertNotIn('COACH_ONE', shared)

    async def test_bots_complete_without_speech_and_phase_ends(self):
        await self.to_private()
        bodies = await asyncio.gather(*(self.complete(who) for who in range(3)))
        self.assertTrue(all(body['assessment']['total'] == 70 for body in bodies))
        self.assertEqual(self.speech.prepared, [])
        ended = await self.view(1)
        self.assertEqual(ended['phase'], 'ended')
        self.assertEqual((ended['game']['ending_label'], ended['game']['ending_title']),
                         (gameplay.PRIVATE_ENDING, 'Private sessions complete'))
        self.assertEqual([item['stage'] for item in ended['game']['private_progress']], ['complete'] * 3)
        self.assertNotIn('total', json.dumps(ended['game']['private_progress']))
        after = await self.session(2)
        self.assertEqual((after['stage'], after['assessment']['total']), ('complete', 70))
        self.assertIn('EXAM_THREE_2', json.dumps(after))
        self.assertNotIn('EXAM_THREE_0', json.dumps(after))

    async def test_deadline_ends_phase_and_closed_sessions_stay_readable(self):
        await self.to_private()
        await self.answer(0, 2, 1)
        self.clock.now += 1501
        ended = await self.view()
        self.assertEqual((ended['phase'], ended['game']['ending_label']), ('ended', gameplay.PRIVATE_ENDING))
        stages = [item['stage'] for item in ended['game']['private_progress']]
        self.assertEqual(stages, ['coaching', 'not_started', 'not_started'])
        body = await self.session(0)
        self.assertEqual((body['stage'], body['expecting'], body['clip']), ('coaching', None, None))
        await self.post(0, 'answer', expected=409, text='Too late')
        missing = await self.clients[1].get(self.path + '/private-session')
        self.assertEqual((missing.status_code, missing.json()['detail']['code']), (404, 'private_session_not_started'))

    async def test_host_skip_ends_private_session(self):
        view = await self.to_private(submit=(1,))
        self.assertIn('skip_phase', view['game']['allowed_actions'])
        await self.session(1)
        await self.action(1, view, 'skip-phase', expected=403)
        ended = await self.action(0, view, 'skip-phase')
        self.assertEqual((ended['phase'], ended['game']['ending_label']), ('ended', gameplay.PRIVATE_ENDING))
        body = await self.session(1)
        self.assertIsNone(body['expecting'])
        self.assertEqual(body['decision_text'], DECISIONS[1])

    async def test_offline_acknowledgement_and_card_when_no_model_is_configured(self):
        self.vertex.configured = False
        self.provider.configured = False
        await self.to_private()
        for step in (1, 2, 3):
            _, body = await self.answer(0, 2, step)
        acks = [item for item in body['messages'] if item['kind'] == 'ack']
        self.assertEqual({item['source'] for item in acks}, {'offline'})
        # Without Gemini the coach cannot record the card: it stays retryable, nothing is invented.
        self.assertEqual((body['stage'], body['card']['status'], body['retryable']), ('card', 'drafting', True))
        self.vertex.configured = True
        await self.post(0, 'retry')
        body = await self.settle()
        self.assertEqual((body['stage'], body['card']['status']), ('assessment', 'confirmed'))
        # Scoring has no offline fabrication: it fails and stays retryable.
        self.vertex.configured = False
        await self.post(0, 'answer', text=ANSWERS[(3, 1)].format(who=0))
        body = await self.settle()
        self.assertTrue(body['retryable'])
        self.assertEqual(body['assessment']['stages'][0]['status'], 'failed')


# The inherited Round 1 tests already run in test_individual_decisions.
for name in [name for name in vars(individual.IndividualDecisionTests) if name.startswith('test_')]:
    setattr(PrivateSessionTests, name, None)


class OtherScenarioPrivateTests(unittest.IsolatedAsyncioTestCase):
    client, view, action = fixture.GameplayTests.client, fixture.GameplayTests.view, fixture.GameplayTests.action
    ready, advance, reach = fixture.GameplayTests.ready, fixture.GameplayTests.advance, fixture.GameplayTests.reach

    async def asyncSetUp(self):
        await fixture.GameplayTests.asyncSetUp(self)

    def test_only_cedar_profiles_enable_private_rounds(self):
        catalog = ScenarioCatalog()
        for timing in catalog.get('maplecart_cybersecurity', 3).timings:
            self.assertFalse(timing.private_rounds)
        for timing in catalog.get('cedar_bridge_t01', 1).timings:
            self.assertEqual((timing.private_rounds, timing.private_session_seconds), (True, 1500))

    async def test_vote_scenario_has_no_private_session(self):
        await self.ready()
        voting = await self.reach('voting')
        self.assertFalse(voting['game']['private_rounds'])
        self.assertIsNone(voting['game']['private_progress'])
        self.assertNotIn('private_session', voting['game']['allowed_actions'])
        response = await self.clients[0].get(self.path + '/private-session')
        self.assertEqual((response.status_code, response.json()['detail']['code']), (409, 'not_private_session'))
        response = await self.clients[0].post(self.path + '/private-session/answer',
                                              json={'command_id': str(uuid4()), 'text': 'Hello', 'used_clip': False})
        self.assertEqual(response.status_code, 409)


if __name__ == '__main__':
    unittest.main()


class QuoteMatchTests(unittest.TestCase):
    def test_tolerates_case_spacing_curly_quotes_and_ellipses_but_not_invention(self):
        from backend.app.private_sessions import quote_in_answer
        answer = "I would appoint the operations manager's deputy now.  Then the board's chair approves access, and IT tests one backup."
        self.assertTrue(quote_in_answer("I would appoint the operations manager’s deputy now.", answer))
        self.assertTrue(quote_in_answer('"then the board\'s chair approves access"', answer))
        self.assertTrue(quote_in_answer("I would appoint … IT tests one backup", answer))
        self.assertFalse(quote_in_answer("IT tests one backup … I would appoint", answer))
        self.assertFalse(quote_in_answer("The vendor restores everything tonight", answer))
        self.assertFalse(quote_in_answer("...", answer))
