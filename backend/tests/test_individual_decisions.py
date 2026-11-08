"""Cedar Bridge individual decision mode: private written decisions replace the board vote."""

import asyncio
import json
import unittest
from datetime import datetime
from uuid import uuid4

from backend.app import gameplay
from backend.app.facilitation import Facilitation
from backend.app.main import create_app
from backend.app.narration import NarrationService
from backend.app.rooms import Rooms
from backend.app.scenarios import ScenarioCatalog
from backend.tests import test_gameplay as fixture
from backend.tests.test_facilitation import Provider

CEDAR_ROLES = ('ceo', 'technology', 'communications')
DECISIONS = ('Appoint the deputy as interim coordinator and authorize paper appointments today.',
             'Keep the system offline until IT verifies the backups; no reopening promise yet.',
             'Publish what is confirmed now and commit to an update at noon.')


class IndividualDecisionTests(unittest.IsolatedAsyncioTestCase):
    client, view, action = fixture.GameplayTests.client, fixture.GameplayTests.view, fixture.GameplayTests.action

    async def asyncSetUp(self):
        self.clock = fixture.Clock()
        self.clock.now = 1000.0
        self.rooms = Rooms(ScenarioCatalog(), self.clock)
        self.provider = Provider()
        self.facilitation = Facilitation(self.rooms, self.provider, NarrationService())
        self.app = create_app(rooms=self.rooms, facilitation_service=self.facilitation)
        self.clients, self.ids = [], []

    async def cedar(self, code='INDIV1'):
        for number in range(3):
            client = await self.client()
            self.clients.append(client)
            response = await client.post('/api/rooms' if number == 0 else '/api/rooms/join',
                                         json=fixture.command(room_code=code, display_name=f'Player {number}'))
            self.assertIn(response.status_code, (200, 201), response.text)
            self.ids.append(response.json()['self_member_id'])
        self.path = '/api/rooms/' + response.json()['room_id']
        self.code = code
        response = await self.clients[0].post(self.path + '/start', json=fixture.command(
            room_code=code, scenario_id='cedar_bridge_t01', scenario_version=1, timing_profile='standard_18',
            players=[{'member_id': member, 'role_id': role} for member, role in zip(self.ids, CEDAR_ROLES)]))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def to_panel(self):
        view = await self.action(0, await self.cedar(), 'briefing/finish')
        self.assertEqual(view['game']['decision_mode'], 'individual')
        self.assertIsNone(view['game']['individual_decisions'])
        while view['phase'] == 'speaking':
            self.assertNotIn('proposal', view['game']['allowed_actions'])
            index = self.ids.index(view['game']['active_speaker_id'])
            saved = await self.clients[index].post(self.path + '/contributions', json=fixture.command(
                phase_id=view['game']['phase_id'], kind='answer', source='typed', text=f'Speaking turn {index}'))
            self.assertEqual(saved.status_code, 201, saved.text)
            view = await self.action(index, view, 'speaker/finish')
        self.assertEqual((view['phase'], view['game']['discussion_mode']), ('discussion', 'experts'))
        return view

    async def to_decision(self):
        view = await self.action(0, await self.to_panel(), 'skip-phase')
        self.assertEqual(view['phase'], 'individual_decision')
        return view

    async def decide(self, index, view, text, expected=200, **fields):
        return await self.action(index, view, 'decision', expected=expected, text=text, **fields)

    async def test_expert_panel_deadline_enters_individual_decision_without_voting(self):
        await self.to_panel()
        seen = set()
        for _ in range(20):
            self.clock.now += 10
            current = await self.view()
            seen.add(current['phase'])
            if current['phase'] == 'individual_decision':
                break
        self.assertNotIn('voting', seen)
        game = current['game']
        self.assertEqual(game['decision_mode'], 'individual')
        self.assertEqual(game['ai_options_status'], 'disabled')
        remaining = (datetime.fromisoformat(game['phase_deadline'])
                     - datetime.fromisoformat(game['server_time'])).total_seconds()
        self.assertLessEqual(remaining, 180)
        self.assertGreater(remaining, 170)
        self.assertEqual(game['individual_decisions']['submitted'], [
            {'member_id': member, 'display_name': f'Player {index}',
             'role_name': ('CEO', 'IT recovery lead', 'Communications lead')[index], 'submitted': False}
            for index, member in enumerate(self.ids)])
        self.assertIsNone(game['individual_decisions']['self'])
        for index in range(3):
            actions = (await self.view(index))['game']['allowed_actions']
            self.assertIn('submit_decision', actions)
            self.assertNotIn('vote', actions)
            self.assertNotIn('proposal', actions)
        self.assertIn('skip_phase', (await self.view(0))['game']['allowed_actions'])
        self.assertNotIn('skip_phase', (await self.view(1))['game']['allowed_actions'])
        # Deadline closes the phase without a vote outcome; Cedar continues into the private rounds.
        self.clock.now += 181
        private = await self.view()
        self.assertEqual(private['phase'], 'private_session')
        self.assertEqual(private['game']['history'], [])
        self.assertEqual([item['submitted'] for item in private['game']['individual_decisions']['submitted']],
                         [False, False, False])

    async def test_submit_resubmit_privacy_idempotency_and_validation(self):
        view = await self.to_decision()
        first = fixture.command(phase_id=view['game']['phase_id'], text=DECISIONS[0])
        route = self.path + '/rounds/' + view['game']['round_id'] + '/decision'
        response = await self.clients[0].post(route, json=first)
        self.assertEqual(response.status_code, 200, response.text)
        retry = await self.clients[0].post(route, json=first)
        self.assertEqual(retry.json(), response.json())
        conflict = await self.clients[0].post(route, json={**first, 'text': 'Different text'})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['detail']['code'], 'command_conflict')
        revised = DECISIONS[0] + ' I still need to confirm who can approve overtime.'
        mine = await self.decide(0, view, revised)
        self.assertEqual(mine['phase'], 'individual_decision')
        self.assertEqual(mine['game']['phase_id'], view['game']['phase_id'])
        self.assertEqual(mine['game']['individual_decisions']['self']['text'], revised)
        self.assertIn('at', mine['game']['individual_decisions']['self'])
        other = await self.view(1)
        self.assertIsNone(other['game']['individual_decisions']['self'])
        self.assertEqual([item['submitted'] for item in other['game']['individual_decisions']['submitted']],
                         [True, False, False])
        for index in (1, 2):
            text = json.dumps(await self.view(index)) + (await self.clients[index].get(self.path + '/contributions')).text
            text += (await self.clients[index].get(self.path + '/extras')).text
            self.assertNotIn(DECISIONS[0], text)
        own = (await self.clients[0].get(self.path + '/contributions')).json()
        self.assertEqual([item['text'] for item in own if item['phase'] == 'individual_decision'],
                         [DECISIONS[0], revised])
        for text in ('', '   ', 'x' * 1201):
            await self.decide(1, view, text, expected=422)
        await self.decide(1, {'game': {**view['game'], 'phase_id': str(uuid4())}}, DECISIONS[1], expected=409)

    async def test_late_member_is_not_eligible(self):
        view = await self.to_decision()
        late = await self.client()
        joined = await late.post('/api/rooms/join', json=fixture.command(
            room_code=self.code, display_name='Late', role_id='operations'))
        self.assertEqual(joined.status_code, 200, joined.text)
        self.clients.append(late)
        current = await self.view(3)
        self.assertNotIn('submit_decision', current['game']['allowed_actions'])
        self.assertEqual(len(current['game']['individual_decisions']['submitted']), 3)
        await self.decide(3, view, 'I want to decide too.', expected=403)

    async def test_auto_end_when_everyone_submitted_and_final_report(self):
        view = await self.to_decision()
        for index in (0, 1):
            self.assertEqual((await self.decide(index, view, DECISIONS[index]))['phase'], 'individual_decision')
        private = await self.decide(2, view, DECISIONS[2])
        self.assertEqual(private['phase'], 'private_session')
        ended = await self.action(0, private, 'skip-phase')
        self.assertEqual(ended['phase'], 'ended')
        game = ended['game']
        self.assertEqual((game['ending_label'], game['ending_title']),
                         ('private_sessions_complete', 'Private sessions complete'))
        self.assertEqual(private['game']['individual_decisions']['self']['text'], DECISIONS[2])
        self.assertEqual(game['individual_decisions']['self']['text'], DECISIONS[0])
        self.assertEqual([item['submitted'] for item in game['individual_decisions']['submitted']], [True] * 3)
        self.assertEqual(game['allowed_actions'], [])
        await self.decide(0, view, 'Too late', expected=409)
        # Others' texts stay out of the game view even after the end.
        self.assertNotIn(DECISIONS[0], json.dumps(await self.view(1)))
        evidence = await self.clients[1].get(self.path + '/evaluation-evidence')
        self.assertEqual(evidence.status_code, 200, evidence.text)
        record = evidence.json()
        self.assertEqual(record['ending_label'], 'private_sessions_complete')
        self.assertEqual(record['decisions'], [])
        decisions = [item for item in record['contributions'] if item['phase'] == 'individual_decision']
        self.assertEqual([(item['member_id'], item['kind'], item['text']) for item in decisions],
                         [(member, 'answer', text) for member, text in zip(self.ids, DECISIONS)])
        report = await self.clients[0].post(self.path + '/feedback', json=fixture.command(phase_id=game['phase_id']))
        self.assertEqual(report.status_code, 200, report.text)
        extras = (await self.clients[0].get(self.path + '/extras')).json()
        self.assertIn('Ending: private_sessions_complete', extras['feedback']['text'])

    async def test_host_skip_ends_individual_decision(self):
        view = await self.to_decision()
        await self.decide(1, view, DECISIONS[1])
        await self.action(1, view, 'skip-phase', expected=403)
        private = await self.action(0, view, 'skip-phase')
        self.assertEqual(private['phase'], 'private_session')
        self.assertEqual([item['submitted'] for item in private['game']['individual_decisions']['submitted']],
                         [False, True, False])

    async def test_no_vote_or_proposal_commands_in_individual_mode(self):
        view = await self.to_panel()
        await self.action(0, view, 'proposal', expected=409, text='A custom option')
        decision = await self.action(0, view, 'skip-phase')
        await self.action(0, decision, 'vote', expected=409, option_id='controlled_continuity')


class OtherScenarioTests(unittest.IsolatedAsyncioTestCase):
    client, view, action = fixture.GameplayTests.client, fixture.GameplayTests.view, fixture.GameplayTests.action
    ready, advance, reach = fixture.GameplayTests.ready, fixture.GameplayTests.advance, fixture.GameplayTests.reach

    async def asyncSetUp(self):
        await fixture.GameplayTests.asyncSetUp(self)

    async def test_vote_scenarios_are_unchanged(self):
        await self.ready()
        speaking = await self.reach('speaking')
        self.assertEqual(speaking['game']['decision_mode'], 'vote')
        self.assertIsNone(speaking['game']['individual_decisions'])
        self.assertIn('proposal', speaking['game']['allowed_actions'])
        voting = await self.reach('voting')
        self.assertNotIn('submit_decision', voting['game']['allowed_actions'])
        self.assertIn('vote', voting['game']['allowed_actions'])
        self.assertIsNone(voting['game']['individual_decisions'])
        self.assertIsNone(voting['game']['ending_title'])
        await self.action(0, voting, 'decision', expected=409, text='Not in this mode')

    def test_timing_defaults_and_cedar_profiles(self):
        catalog = ScenarioCatalog()
        for timing in catalog.get('maplecart_cybersecurity', 3).timings:
            self.assertEqual(timing.decision_mode, 'vote')
        for timing in catalog.get('cedar_bridge_t01', 1).timings:
            self.assertEqual((timing.decision_mode, timing.individual_decision_seconds), ('individual', 180))
        self.assertEqual(gameplay.INDIVIDUAL_ENDING_TITLE, 'Individual decisions recorded')


if __name__ == '__main__':
    unittest.main()
