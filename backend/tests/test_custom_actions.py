"""Custom winners, unrestricted proposals and strict asynchronous authority."""

import asyncio
from dataclasses import replace
import hashlib
import json
import unittest
from uuid import UUID, uuid4

from backend.app.main import create_app
from backend.app.custom_resolution import CustomResolver, fragments
from backend.tests import test_gameplay as fixture


class Provider:
    configured = True
    def __init__(self): self.prompts = []; self.fail = False
    async def run(self, prompt, request_id, timeout):
        self.prompts.append(prompt)
        if self.fail: return '{"outcome":"invented"}'
        if '"notes"' in prompt:
            return '{"notes":"Preserve evidence and use proportionate containment."}'
        return '{"outcome":"O1"}'


class CustomTests(unittest.IsolatedAsyncioTestCase):
    client, ready, view, reach, advance, action = (fixture.GameplayTests.client, fixture.GameplayTests.ready,
        fixture.GameplayTests.view, fixture.GameplayTests.reach, fixture.GameplayTests.advance, fixture.GameplayTests.action)

    async def asyncSetUp(self):
        await fixture.GameplayTests.asyncSetUp(self)
        self.provider = Provider()
        self.app = create_app(rooms=self.rooms, inference_provider=self.provider)
        self.resolver = self.app.state.resolver

    async def selected(self, text='Isolate affected devices, preserve logs and appoint an incident lead.'):
        await self.ready()
        speaking = await self.reach('speaking')
        proposal = await self.action(0, speaking, 'proposal', text=text)
        custom = proposal['game']['proposals'][0]['option_id']
        voting = await self.reach('voting')
        self.assertTrue(any(option['option_id'] == custom and option['kind'] == 'custom' for option in voting['game']['current_node']['options']))
        await self.action(0, voting, 'vote', option_id=custom)
        resolving = await self.advance(60)
        self.assertEqual(resolving['phase'], 'resolving')
        return resolving, custom

    async def finish(self):
        await self.resolver.tick()
        await asyncio.gather(*self.resolver.tasks.values())
        return await self.view()

    async def test_custom_winner_maps_only_to_allowed_authored_consequence(self):
        before, option = await self.selected()
        result = await self.finish()
        self.assertEqual(result['phase'], 'result')
        record = result['game']['last_result']
        self.assertEqual(record['resolution_kind'], 'custom')
        self.assertEqual(record['selected_option_id'], option)
        self.assertEqual(record['proposer_id'], self.ids[0])
        self.assertEqual(record['outcome_id'], 'targeted_containment')
        self.assertEqual(record['ai_job_id'], before['game']['resolution']['job_id'])
        self.assertEqual(sum(record['vote_counts'].values()), 1)
        self.assertEqual(len(result['game']['history']), 1)
        captured = self.rooms.rooms[self.room_id].phase.state
        await self.resolver.tick()
        self.assertEqual(self.rooms.rooms[self.room_id].phase.state.history, captured.history)

    async def test_unrestricted_text_fragment_coverage_and_exact_retention(self):
        text = ('Keep every character, including quotes " and slashes \\ . ' * 150) + 'FINAL_FRAGMENT_MARKER'
        before, _ = await self.selected(text)
        result = await self.finish()
        self.assertEqual(result['phase'], 'result')
        self.assertEqual(result['game']['last_result']['selected_option_label'], text)
        self.assertEqual(result['game']['resolution']['text_sha256'], hashlib.sha256(text.encode()).hexdigest())
        self.assertTrue(all(len(prompt) <= 4000 for prompt in self.provider.prompts))
        self.assertIn('FINAL_FRAGMENT_MARKER', '\n'.join(self.provider.prompts))
        self.assertEqual(''.join(fragments(text)), text)
        self.assertEqual(result['game']['resolution']['processed_fragments'], result['game']['resolution']['total_fragments'])
        self.assertGreater(result['game']['resolution']['total_fragments'], 1)

    async def test_edit_withdraw_history_and_freeze_at_voting(self):
        await self.ready()
        speaking = await self.reach('speaking')
        first = await self.action(0, speaking, 'proposal', text='First proposal')
        option = first['game']['proposals'][0]['option_id']
        changed = await self.action(0, speaking, 'proposal', text='Changed proposal')
        self.assertEqual(changed['game']['proposals'][0]['option_id'], option)
        withdrawn = await self.action(0, speaking, 'proposal', text='')
        self.assertEqual(withdrawn['game']['proposals'], [])
        await self.action(0, speaking, 'proposal', text='Final proposal')
        voting = await self.reach('voting')
        await self.action(0, voting, 'proposal', expected=409, text='Too late')
        contributions = (await self.clients[0].get(self.path + '/contributions')).json()
        self.assertEqual([item['text'] for item in contributions], ['First proposal','Changed proposal','Final proposal'])

    async def test_invalid_provider_is_explicit_and_only_one_host_retry_is_allowed(self):
        self.provider.fail = True
        await self.selected()
        failed = await self.finish()
        self.assertEqual(failed['phase'], 'resolution_failed')
        self.assertEqual(failed['game']['history'], [])
        await self.action(1, failed, 'resolution/retry', expected=403)
        await self.action(0, failed, 'resolution/retry')
        failed = await self.finish()
        self.assertEqual(failed['game']['resolution']['attempt'], 2)
        await self.action(0, failed, 'resolution/retry', expected=409)

    async def test_late_attempt_cannot_override_retry_or_ended_state(self):
        await self.selected()
        captured = self.rooms.rooms[self.room_id].phase.state
        failed = await self.advance(15)
        self.assertEqual(failed['phase'], 'resolution_failed')
        retried = await self.action(0, failed, 'resolution/retry')
        self.assertFalse(await self.resolver.complete(self.room_id, captured, 'targeted_containment'))
        self.assertEqual((await self.view())['game']['resolution']['job_id'], retried['game']['resolution']['job_id'])
        state = self.rooms.rooms[self.room_id].phase.state
        await self.clients[0].post(self.path + '/end', json=fixture.command(phase_id=retried['game']['phase_id']))
        self.assertFalse(await self.resolver.complete(self.room_id, state, 'targeted_containment'))
        evidence = (await self.clients[0].get(self.path + '/evaluation-evidence')).json()
        self.assertEqual(evidence['unresolved_action']['text'], captured.resolution.text)
        self.assertEqual(evidence['unresolved_action']['status'], 'unresolved')
        self.assertEqual(evidence['decisions'], [])

    async def test_total_timeout_at_ai_completion_freezes_unresolved_selection(self):
        await self.selected()
        room = self.rooms.rooms[self.room_id]
        captured = room.phase.state
        room.phase = replace(room.phase, state=replace(captured, session_deadline=self.clock.now + 1))
        self.clock.now += 1
        self.assertFalse(await self.resolver.complete(self.room_id, captured, 'targeted_containment'))
        ended = await self.view()
        self.assertEqual(ended['game']['ending_label'], 'total_timeout')
        self.assertEqual(ended['game']['history'], [])

    async def test_ceo_can_select_a_tied_custom_winner(self):
        await self.ready()
        speaking = await self.reach('speaking')
        proposal = await self.action(0, speaking, 'proposal', text='Preserve logs and restrict the affected finance account.')
        option = proposal['game']['proposals'][0]['option_id']
        voting = await self.reach('voting')
        prepared = voting['game']['current_node']['options'][0]['option_id']
        await self.action(0, voting, 'vote', option_id=option)
        await self.action(1, voting, 'vote', option_id=prepared)
        tied = await self.advance(60)
        selected = await self.action(1, tied, 'tie-decision', option_id=option)
        self.assertEqual(selected['phase'], 'resolving')
        result = await self.finish()
        self.assertEqual(result['game']['last_result']['selection_method'], 'ceo')

    async def test_invalid_unicode_cannot_poison_room_or_contributions(self):
        await self.ready()
        current = await self.reach('speaking')
        response = await self.clients[0].post(self.path + '/rounds/' + current['game']['round_id'] + '/proposal',
            content=json.dumps(fixture.command(phase_id=current['game']['phase_id'], text='Keep\ud800all')),
            headers={'Content-Type': 'application/json'})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual((await self.view())['game']['proposals'], [])
        response = await self.clients[0].post(self.path + '/contributions',
            content=json.dumps(fixture.command(phase_id=current['game']['phase_id'], kind='chat', source='typed', text='Bad\ud800text')),
            headers={'Content-Type':'application/json'})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual((await self.view())['phase'], 'speaking')


if __name__ == '__main__': unittest.main()
