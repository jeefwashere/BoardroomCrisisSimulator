"""Rounds 2 and 3: private coaching and scored assessment per member, with fake providers only."""

import asyncio
from datetime import datetime
import json
import unittest
from types import SimpleNamespace
from uuid import uuid4

from backend.app import gameplay
from backend.app.facilitation import Facilitation
from backend.app.prerecorded import load_prerecorded
from backend.app.main import create_app
from backend.app.private_sessions import (CARD_RECORDED, CARD_FIELDS, COACH_UPDATE, EXAM_UPDATE, QUESTIONS, TRANSITION, TWIST,
                                          QuizError, full_question, validate_quiz)
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
}


def quiz_reply(tag='EXAM'):
    """A valid Gemini assessment: the best choice is always listed first, so shuffling is observable."""
    return {'questions': [{'question': f'{tag}_Q{n}: The provider is delayed. Who should authorize access first?',
                           'choices': [{'text': f'{tag} best choice {n}', 'points': 20, 'rationale': f'{tag} best reason {n}'},
                                       {'text': f'{tag} good choice {n}', 'points': 12, 'rationale': 'Partly right.'},
                                       {'text': f'{tag} weak choice {n}', 'points': 5, 'rationale': 'Misses a dependency.'},
                                       {'text': f'{tag} worst choice {n}', 'points': 0, 'rationale': 'Invents a fact.'}]}
                          for n in range(1, 6)]}


class FakeVertex:
    """Answers acknowledgement, card and quiz prompts. Modes inject invalid or failing quiz output."""

    configured = True

    def __init__(self):
        self.prompts, self.temperatures, self.mode = [], [], None
        self.gate = asyncio.Event()
        self.gate.set()

    async def json(self, prompt, timeout=30, max_output_tokens=2048, temperature=0.4):
        self.prompts.append(prompt)
        self.temperatures.append(temperature)
        await self.gate.wait()
        task = prompt.split('\n', 1)[0]
        if 'multiple choice assessment' in task:
            if self.mode == 'fail':
                raise RuntimeError('private provider detail')
            reply = quiz_reply()
            if self.mode == 'points':
                reply['questions'][0]['choices'][2]['points'] = 12
            elif self.mode == 'short':
                reply['questions'].pop()
            return reply
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

    def choice_with(self, who, step, points):
        """Test only: read the hidden points on the server to pick a known choice."""
        branch = next(item for (_, member), item in self.facilitation.private.branches.items()
                      if str(member) == str(self.ids[who]))
        question = branch['quiz']['questions'][step - 1]
        return next(item['choice_id'] for item in question['choices'] if item['points'] == points)

    async def choose(self, who, step, points, expected=200, command_id=None):
        return await self.post(who, 'choice', expected=expected, command_id=command_id, step=step,
                               choice_id=self.choice_with(who, step, points))

    async def complete(self, who, points=(20, 20, 20, 20, 20)):
        body = await self.coach(who)
        self.assertEqual(body['quiz']['current'], 1)
        for step in range(1, 6):
            body = await self.choose(who, step, points[step - 1])
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
                         [('twist', TWIST), ('question', QUESTIONS[0])])
        self.assertTrue(all(item['author'] == 'agent' and item['source'] == 'canonical' and item['speech_id']
                            for item in body['messages']))
        self.assertEqual((body['round'], body['stage'], body['agent']),
                         (2, 'coaching', {'label': 'Crisis coach', 'role': 'coach'}))
        self.assertEqual(body['expecting'], {'round': 2, 'step': 1, 'question': full_question(1)})
        self.assertEqual(body['decision_text'], DECISIONS[0])
        self.assertEqual(body['clip']['clip_id'], 'r2_member_1_step_1')
        self.assertEqual(body['clip']['audio_url'], '/api/recordings/r2_member_1_step_1/audio')
        self.assertGreater(body['clip']['duration_seconds'], 0)
        self.assertTrue(body['clip']['text'])
        audio = await self.clients[0].get(body['clip']['audio_url'])
        self.assertEqual((audio.status_code, audio.headers['content-type']), (200, 'audio/mpeg'))
        self.assertEqual((await self.session(1))['clip']['clip_id'], 'r2_member_2_step_1')
        self.assertEqual(body['assessment'], {'stages': [
            {'step': step, 'max': 20, 'points': None, 'status': 'waiting'} for step in range(1, 6)],
            'total': None, 'max': 100, 'feedback': None})
        self.assertEqual((body['busy'], body['card'], body['quiz'], body['retryable']), (False, None, None, False))
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
        self.assertEqual(body['expecting']['question'], full_question(2))
        self.assertEqual(body['clip']['clip_id'], 'r2_member_1_step_2')
        for step in (2, 3):
            _, body = await self.answer(0, 2, step)
        draft = {field: f'Draft {field} from my plan.' for field in CARD_FIELDS}
        self.assertEqual(body['card'], {'status': 'confirmed', 'fields': draft})
        self.assertEqual(body['assessment']['total'], None)
        confirmed = body
        self.assertEqual((confirmed['round'], confirmed['stage'], confirmed['agent']['role']), (3, 'assessment', 'examiner'))
        self.assertEqual([(item['kind'], item['text']) for item in confirmed['messages'][-3:-1]],
                         [('update', CARD_RECORDED), ('transition', TRANSITION)])
        # Round 3 has no free text: the examiner asks the first generated question and shows four choices.
        question = confirmed['messages'][-1]
        self.assertEqual((question['kind'], question['round'], question['step'], question['status'], question['source']),
                         ('question', 3, 1, 'ready', 'vertex'))
        self.assertEqual(question['text'], 'EXAM_Q1: The provider is delayed. Who should authorize access first?')
        self.assertTrue(question['speech_id'])
        self.assertEqual((confirmed['expecting'], confirmed['clip']), (None, None))
        quiz = confirmed['quiz']
        self.assertEqual((quiz['status'], quiz['current'], quiz['total'], quiz['max'], quiz['review']),
                         ('ready', 1, 0, 100, None))
        self.assertEqual(len(quiz['questions']), 1)
        self.assertEqual([item['choice_id'] for item in quiz['questions'][0]['choices']], ['a', 'b', 'c', 'd'])
        self.assertTrue(all(set(item) == {'choice_id', 'text'} for item in quiz['questions'][0]['choices']))
        self.assertNotIn('rationale', json.dumps(confirmed))
        self.assertNotIn('EXAM best reason', json.dumps(confirmed))
        # The quiz prompt is grounded in this member's role, decision, coaching answers and recorded card.
        quiz_prompts = [prompt for prompt in self.vertex.prompts if 'multiple choice assessment' in prompt]
        self.assertEqual(len(quiz_prompts), 1)
        for expected in (DECISIONS[0], 'COACH_ONE_0', 'Draft action from my plan.', '"own_role": "CEO"', EXAM_UPDATE):
            self.assertIn(expected, quiz_prompts[0])
        self.assertEqual(self.vertex.temperatures[-1], 0.4)
        # The old card review command no longer applies, and the free text answer route is closed.
        await self.post(0, 'card', expected=409, fields={field: 'Edited.' for field in CARD_FIELDS})
        await self.post(0, 'answer', expected=409, text='Free text in Round 3')
        future = await self.clients[0].post(self.path + '/private-session/choice',
                                            json={'command_id': str(uuid4()), 'step': 2, 'choice_id': 'a'})
        self.assertEqual((future.status_code, future.json()['detail']['code']), (409, 'not_current_question'))
        invalid = await self.clients[0].post(self.path + '/private-session/choice',
                                             json={'command_id': str(uuid4()), 'step': 1, 'choice_id': 'e'})
        self.assertEqual((invalid.status_code, invalid.json()['detail']['code']), (422, 'invalid_choice'))
        malformed = await self.clients[0].post(self.path + '/private-session/choice',
                                               json={'command_id': str(uuid4()), 'step': 6, 'choice_id': 'a'})
        self.assertEqual(malformed.status_code, 422)
        command_id = str(uuid4())
        body = await self.choose(0, 1, 12, command_id=command_id)
        first = body['quiz']['questions'][0]
        self.assertEqual((first['chosen'], first['points'], first['max']), (self.choice_with(0, 1, 12), 12, 20))
        self.assertEqual((body['quiz']['total'], body['quiz']['current'], len(body['quiz']['questions'])), (12, 2, 2))
        self.assertEqual(body['assessment']['stages'][0], {'step': 1, 'max': 20, 'points': 12, 'status': 'scored'})
        self.assertEqual([(item['author'], item['kind'], item['step']) for item in body['messages'][-3:]],
                         [('member', 'answer', 1), ('agent', 'result', 1), ('agent', 'question', 2)])
        self.assertEqual(body['messages'][-2]['text'], 'Question 1: 12 of 20 points.')
        self.assertNotIn('rationale', json.dumps(body))
        again = await self.choose(0, 1, 12, command_id=command_id)
        self.assertEqual(again['messages'], body['messages'])
        await self.choose(0, 1, 20, expected=409, command_id=command_id)
        repeat = await self.clients[0].post(self.path + '/private-session/choice',
                                            json={'command_id': str(uuid4()), 'step': 1, 'choice_id': 'a'})
        self.assertEqual(repeat.json()['detail']['code'], 'already_answered')
        totals = (12, 32, 32, 37, 57)
        for step, points in zip(range(2, 6), (20, 0, 5, 20)):
            body = await self.choose(0, step, points)
            self.assertEqual(body['quiz']['total'], totals[step - 1])
            if step < 5:
                self.assertEqual((body['stage'], body['quiz']['review']), ('assessment', None))
        self.assertEqual((body['stage'], body['expecting'], body['quiz']['current']), ('complete', None, None))
        self.assertIn('complete with 57 of 100 points', body['messages'][-1]['text'])
        self.assertEqual((body['assessment']['total'], body['assessment']['feedback']), (57, None))
        review = body['quiz']['review']
        self.assertEqual([item['step'] for item in review], [1, 2, 3, 4, 5])
        self.assertEqual((review[0]['points'], review[0]['chosen']), (12, self.choice_with(0, 1, 12)))
        self.assertTrue(all(set(choice) == {'choice_id', 'text', 'points', 'rationale'}
                            for item in review for choice in item['choices']))
        self.assertEqual(sorted(choice['points'] for choice in review[0]['choices']), [0, 5, 12, 20])
        stages = {item['member_id']: item['stage'] for item in (await self.view())['game']['private_progress']}
        self.assertEqual(stages[self.ids[0]], 'complete')
        self.assertEqual((await self.view())['phase'], 'private_session')
        await self.post(0, 'answer', expected=409, text='Already complete')
        await self.post(0, 'retry', expected=409)
        self.assertEqual(self.speech.prepared, [])

    async def test_quiz_choices_are_shuffled(self):
        await self.to_private()
        body = await self.coach(0)
        self.assertEqual(body['quiz']['status'], 'ready')
        best = [self.choice_with(0, step, 20) for step in range(1, 6)]
        # Gemini lists the best choice first; with five shuffles all landing on "a" being 1 in 1024, this is stable.
        self.assertNotEqual(best, ['a'] * 5)

    async def test_invalid_quiz_retries_once_then_fails_and_retries(self):
        await self.to_private()
        self.vertex.mode = 'points'
        for step in (1, 2, 3):
            _, body = await self.answer(0, 2, step)
        self.assertEqual((body['stage'], body['quiz']['status'], body['retryable']), ('assessment', 'failed', True))
        self.assertEqual((body['quiz']['current'], body['quiz']['questions']), (None, []))
        quiz_prompts = [prompt for prompt in self.vertex.prompts if 'multiple choice assessment' in prompt]
        self.assertEqual(len(quiz_prompts), 2)
        self.assertIn('previous assessment was rejected', quiz_prompts[1])
        choice = await self.clients[0].post(self.path + '/private-session/choice',
                                            json={'command_id': str(uuid4()), 'step': 1, 'choice_id': 'a'})
        self.assertEqual(choice.json()['detail']['code'], 'quiz_not_ready')
        for mode in ('short', 'fail'):
            self.vertex.mode = mode
            retried = await self.post(0, 'retry')
            self.assertTrue(retried['busy'])
            self.assertEqual(retried['quiz']['status'], 'generating')
            body = await self.settle()
            self.assertEqual((body['quiz']['status'], body['retryable']), ('failed', True), mode)
            self.assertNotIn('private provider', json.dumps(body))
        self.vertex.mode = None
        await self.post(0, 'retry')
        body = await self.settle()
        self.assertEqual((body['quiz']['status'], body['quiz']['current'], body['retryable']), ('ready', 1, False))
        self.assertEqual(body['messages'][-1]['kind'], 'question')

    async def test_question_timer_closes_with_zero_and_rejects_late_picks(self):
        await self.to_private()
        body = await self.coach(0)
        quiz = body['quiz']
        self.assertEqual((quiz['question_seconds'], quiz['questions'][0]['timed_out']), (60, False))
        left = (datetime.fromisoformat(quiz['questions'][0]['deadline'])
                - datetime.fromisoformat(quiz['server_time'])).total_seconds()
        self.assertAlmostEqual(left, 60, delta=1)
        # Within the 1.5 second grace a pick still counts.
        self.clock.now += 61
        body = await self.choose(0, 1, 20)
        self.assertEqual((body['quiz']['total'], body['quiz']['current']), (20, 2))
        self.clock.now += 61.6
        body = await self.session(0)
        second = body['quiz']['questions'][1]
        self.assertEqual((second['timed_out'], second['points'], second['chosen']), (True, 0, None))
        self.assertEqual((body['quiz']['current'], body['quiz']['total']), (3, 20))
        self.assertEqual(body['messages'][-2]['text'], 'Question 2: time is up, 0 of 20 points.')
        again = await self.session(0)
        self.assertEqual(len(again['messages']), len(body['messages']))
        late = await self.clients[0].post(self.path + '/private-session/choice',
                                          json={'command_id': str(uuid4()), 'step': 2, 'choice_id': 'a'})
        self.assertEqual((late.status_code, late.json()['detail']['code']), (409, 'question_timed_out'))
        for _ in range(3):
            self.clock.now += 62
            body = await self.session(0)
        self.assertEqual((body['stage'], body['quiz']['total']), ('complete', 20))
        self.assertEqual([item['timed_out'] for item in body['quiz']['review']], [False, True, True, True, True])

    async def test_start_at_assessment_uses_prerecorded_answers(self):
        for number in range(3):
            client = await self.client()
            self.clients.append(client)
            response = await client.post('/api/rooms' if number == 0 else '/api/rooms/join',
                                         json=fixture.command(room_code='ROUND3', display_name=f'Player {number}'))
            self.ids.append(response.json()['self_member_id'])
        self.path = '/api/rooms/' + response.json()['room_id']
        response = await self.clients[0].post(self.path + '/start', json=fixture.command(
            room_code='ROUND3', scenario_id='cedar_bridge_t01', scenario_version=1, timing_profile='standard_18',
            players=[{'member_id': member, 'role_id': role} for member, role in zip(self.ids, individual.CEDAR_ROLES)],
            start_at='assessment'))
        self.assertEqual(response.status_code, 200, response.text)
        game = response.json()['game']
        self.assertEqual((game['phase'], game['start_at']), ('private_session', 'assessment'))
        self.assertEqual([item['stage'] for item in game['private_progress']], ['assessment'] * 3)
        remaining = (datetime.fromisoformat(game['phase_deadline'])
                     - datetime.fromisoformat(game['server_time'])).total_seconds()
        self.assertGreaterEqual(remaining, 600)
        recorded = load_prerecorded()
        # Every member's quiz starts at game start, before anyone opens their session.
        await asyncio.sleep(0.05)
        quiz_prompts = [prompt for prompt in self.vertex.prompts if 'multiple choice assessment' in prompt]
        self.assertEqual(len(quiz_prompts), 3)
        for who in range(3):
            body = await self.settle(who)
            self.assertEqual((body['stage'], body['quiz']['status'], body['quiz']['current']), ('assessment', 'ready', 1))
            self.assertEqual(body['decision_text'], recorded[who]['decision'])
            answers = [item['text'] for item in body['messages'] if item['author'] == 'member']
            self.assertEqual(answers, list(recorded[who]['coaching']))
            self.assertTrue(any(item['text'].startswith('Test start: prerecorded answers') for item in body['messages']))
            self.assertEqual((await self.view(who))['game']['individual_decisions']['self']['text'],
                             recorded[who]['decision'])
        self.assertTrue(any(recorded[0]['coaching'][0] in prompt for prompt in quiz_prompts))
        bodies = await asyncio.gather(*(self.choose_all(who) for who in range(3)))
        self.assertTrue(all(body['stage'] == 'complete' for body in bodies))
        self.assertEqual((await self.view())['phase'], 'ended')

    async def choose_all(self, who):
        body = None
        for step in range(1, 6):
            body = await self.choose(who, step, 20)
        return body

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
        self.assertTrue(all(body['assessment']['total'] == 100 and body['quiz']['total'] == 100 for body in bodies))
        self.assertEqual(self.speech.prepared, [])
        ended = await self.view(1)
        self.assertEqual(ended['phase'], 'ended')
        self.assertEqual((ended['game']['ending_label'], ended['game']['ending_title']),
                         (gameplay.PRIVATE_ENDING, 'Private sessions complete'))
        self.assertEqual([item['stage'] for item in ended['game']['private_progress']], ['complete'] * 3)
        self.assertNotIn('total', json.dumps(ended['game']['private_progress']))
        after = await self.session(2)
        self.assertEqual((after['stage'], after['assessment']['total']), ('complete', 100))
        self.assertIn('COACH_ONE_2', json.dumps(after))
        self.assertNotIn('COACH_ONE_0', json.dumps(after))

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
        # The card is recorded, then Vertex goes away before the quiz: no offline or hosted quiz is fabricated.
        self.vertex.configured = True
        self.vertex.gate.clear()
        await self.post(0, 'retry')
        for _ in range(100):
            if self.vertex.prompts and 'draft card' in self.vertex.prompts[-1]:
                break
            await asyncio.sleep(0.01)
        self.vertex.configured = False
        self.vertex.gate.set()
        body = await self.settle()
        self.assertEqual((body['stage'], body['card']['status']), ('assessment', 'confirmed'))
        self.assertEqual((body['quiz']['status'], body['retryable']), ('failed', True))
        self.assertFalse(any('multiple choice assessment' in prompt for prompt in self.vertex.prompts))
        self.vertex.configured = True
        await self.post(0, 'retry')
        body = await self.settle()
        self.assertEqual((body['quiz']['status'], body['quiz']['current']), ('ready', 1))


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



class QuizValidationTests(unittest.TestCase):
    def test_accepts_valid_and_rejects_every_rule_break(self):
        self.assertEqual(len(validate_quiz(quiz_reply())), 5)
        breaks = {
            'four questions': lambda q: q['questions'].pop(),
            'three choices': lambda q: q['questions'][0]['choices'].pop(),
            'equal middle points': lambda q: q['questions'][1]['choices'][2].update(points=12),
            'no zero': lambda q: q['questions'][1]['choices'][3].update(points=1),
            'two twenties': lambda q: q['questions'][1]['choices'][1].update(points=20),
            'float points': lambda q: q['questions'][2]['choices'][1].update(points=12.0),
            'boolean points': lambda q: q['questions'][2]['choices'][3].update(points=False),
            'short question': lambda q: q['questions'][3].update(question='Why?'),
            'long question': lambda q: q['questions'][3].update(question='x' * 401),
            'blank rationale': lambda q: q['questions'][4]['choices'][0].update(rationale='  '),
            'short choice': lambda q: q['questions'][4]['choices'][0].update(text='A'),
            'duplicate choice': lambda q: q['questions'][4]['choices'][1].update(text='EXAM BEST choice 5'),
            'not a list': lambda q: q.update(questions='none'),
        }
        for label, mutate in breaks.items():
            quiz = quiz_reply()
            mutate(quiz)
            with self.assertRaises(QuizError, msg=label):
                validate_quiz(quiz)


if __name__ == '__main__':
    unittest.main()
