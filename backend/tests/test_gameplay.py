"""Production HTTP acceptance, with a controlled server clock and real identities."""

import asyncio
from dataclasses import replace
from datetime import datetime
import os
import unittest
from uuid import UUID, uuid4

import httpx2 as httpx

from backend.app.main import SESSION_HEADER, create_app
from backend.app.rooms import Rooms
from backend.app.scenarios import ScenarioCatalog
from backend.app import simulation as sim

# Automated tests never make paid Vertex calls; tests inject fakes explicitly.
os.environ["BOARDROOM_VERTEX_ENABLED"] = "false"


def command(**fields):
    return {"command_id": str(uuid4()), **fields}


class Clock:
    now = 1000.0

    def __call__(self):
        return self.now


class GameplayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = Clock()
        self.rooms = Rooms(ScenarioCatalog(), self.clock)
        self.app = create_app(rooms=self.rooms)
        self.clients, self.ids = [], []

    async def client(self):
        client = await self.enterAsyncContext(httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"))
        token = (await client.post('/api/tab-sessions', json={})).json()['session_token']
        client.headers[SESSION_HEADER] = token
        return client

    async def ready(self, count=3, code="PLAY01"):
        for number in range(count):
            client = await self.client()
            self.clients.append(client)
            body = command(room_code=code, display_name=f'Player {number}')
            if number == 0:
                self.create_body = body
            response = await client.post('/api/rooms' if number == 0 else '/api/rooms/join', json=body)
            self.assertIn(response.status_code, (200, 201), response.text)
            view = response.json()
            self.ids.append(view['self_member_id'])
        self.path = '/api/rooms/' + view['room_id']
        self.room_id = UUID(view['room_id'])
        self.start_body = command(
            room_code=code, scenario_id='maplecart_cybersecurity', scenario_version=3,
            timing_profile='standard_18', players=[
                {'member_id': member, 'role_id': 'ceo' if index == 1 else 'security'}
                for index, member in enumerate(self.ids)])
        response = await self.clients[0].post(self.path + '/start', json=self.start_body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def view(self, index=0):
        response = await self.clients[index].get(self.path)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def advance(self, seconds, alive=True):
        while seconds > 0:
            step = min(10, seconds)
            self.clock.now += step
            seconds -= step
            if alive:
                await asyncio.gather(*(client.get(self.path) for client in self.clients))
        return await self.view()

    async def reach(self, phase):
        for _ in range(250):
            view = await self.view()
            if view['phase'] == phase:
                return view
            self.assertNotEqual(view['phase'], 'ended', view)
            await self.advance(5)
        self.fail('Phase was never reached: ' + phase)

    async def action(self, index, view, route, expected=200, **fields):
        response = await self.clients[index].post(
            self.path + '/rounds/' + view['game']['round_id'] + '/' + route,
            json=command(phase_id=view['game']['phase_id'], **fields))
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    async def test_host_finishes_briefing_after_spoken_opening(self):
        briefing = await self.ready()
        self.assertEqual(briefing['phase'], 'briefing')
        self.assertIn('finish_briefing', (await self.view(0))['game']['allowed_actions'])
        self.assertNotIn('finish_briefing', (await self.view(1))['game']['allowed_actions'])
        await self.action(1, briefing, 'briefing/finish', expected=403)
        speaking = await self.action(0, briefing, 'briefing/finish')
        self.assertEqual(speaking['phase'], 'speaking')
        await self.action(0, briefing, 'briefing/finish', expected=409)

    async def test_host_skips_each_timed_phase(self):
        view = await self.ready()
        await self.action(1, view, 'skip-phase', expected=403)
        seen = []
        for _ in range(8):
            if view['phase'] in ('ended', 'decision', 'resolving'):
                break
            self.assertIn('skip_phase', view['game']['allowed_actions'])
            view = await self.action(0, view, 'skip-phase')
            seen.append(view['phase'])
        self.assertIn('voting', seen)
        self.assertEqual(seen[0], 'speaking')

    async def test_ceo_can_skip_turn_and_finish_discussion_without_bypassing_votes(self):
        briefing = await self.ready()
        speaking = await self.action(0, briefing, 'briefing/finish')
        ceo = await self.view(1)
        self.assertIn('skip_speaker', ceo['game']['allowed_actions'])
        self.assertIn('skip_phase', ceo['game']['allowed_actions'])
        guest = await self.view(2)
        self.assertNotIn('skip_speaker', guest['game']['allowed_actions'])
        self.assertNotIn('skip_phase', guest['game']['allowed_actions'])
        await self.action(2, speaking, 'speaker/skip', expected=403, reason='Not authorized')
        await self.action(2, speaking, 'skip-phase', expected=403)
        skipped = await self.action(1, speaking, 'speaker/skip', reason='Move to the next speaker')
        self.assertEqual(skipped['game']['active_speaker_id'], self.ids[1])
        self.assertEqual(len(skipped['game']['turns']), 1)
        self.assertEqual(skipped['game']['turns'][0]['actor_id'], self.ids[1])
        self.assertEqual(skipped['game']['turns'][0]['reason'], 'ceo_skip: Move to the next speaker')
        voting = await self.action(1, skipped, 'skip-phase')
        self.assertEqual(voting['phase'], 'voting')
        self.assertEqual(voting['game']['history'], [])
        self.assertEqual(voting['game']['eligible_member_ids'], self.ids)
        self.assertEqual(voting['game']['turns'][-1]['member_id'], self.ids[1])
        self.assertEqual(voting['game']['turns'][-1]['actor_id'], self.ids[1])
        self.assertEqual(voting['game']['turns'][-1]['reason'], 'ceo_finish_round')
        self.assertNotIn('skip_phase', voting['game']['allowed_actions'])
        await self.action(1, voting, 'skip-phase', expected=403)
        option_id = voting['game']['current_node']['options'][0]['option_id']
        voted = await self.action(1, voting, 'vote', option_id=option_id)
        self.assertEqual(voted['phase'], 'voting')
        self.assertEqual(voted['game']['self_vote'], option_id)

    async def test_ceo_can_finish_remaining_discussion(self):
        await self.ready()
        discussion = await self.reach('discussion')
        ceo = await self.view(1)
        self.assertIn('skip_phase', ceo['game']['allowed_actions'])
        voting = await self.action(1, discussion, 'skip-phase')
        self.assertEqual(voting['phase'], 'voting')
        self.assertEqual(len(voting['game']['turns']), 3)

    async def test_complete_game_tie_late_admission_and_frozen_evidence(self):
        await self.ready()
        speaker = await self.reach('speaking')
        self.assertEqual(speaker['game']['active_speaker_id'], self.ids[0])
        self.assertIn('finish_speaking', speaker['game']['allowed_actions'])
        await self.action(1, speaker, 'speaker/finish', expected=403)
        speaker = await self.action(0, speaker, 'speaker/finish')
        self.assertEqual(speaker['game']['active_speaker_id'], self.ids[1])
        speaker = await self.action(0, speaker, 'speaker/skip', reason='Requested a pass')
        self.assertEqual(speaker['game']['active_speaker_id'], self.ids[2])
        discussion = await self.action(2, speaker, 'speaker/finish')
        self.assertEqual(discussion['phase'], 'discussion')
        late = await self.client()
        joined = await late.post('/api/rooms/join', json=command(
            room_code='PLAY01', display_name='Late', role_id='finance'))
        self.assertEqual(joined.status_code, 200, joined.text)
        late_id = joined.json()['self_member_id']
        self.clients.append(late)
        voting = await self.reach('voting')
        self.assertNotIn(late_id, voting['game']['eligible_member_ids'])
        options = voting['game']['current_node']['options']
        await self.action(3, voting, 'vote', expected=403, option_id=options[0]['option_id'])
        first = await self.action(0, voting, 'vote', option_id=options[0]['option_id'])
        self.assertIsNone(first['game']['vote_counts'])
        await self.action(1, voting, 'vote', option_id=options[1]['option_id'])
        tied = await self.advance(60)
        self.assertEqual(tied['phase'], 'tie_break')
        await self.action(0, tied, 'tie-decision', expected=403, option_id=options[0]['option_id'])
        await self.action(1, tied, 'tie-decision', expected=422, option_id=options[2]['option_id'])
        result = await self.action(1, tied, 'tie-decision', option_id=options[0]['option_id'])
        self.assertEqual(result['phase'], 'result')
        self.assertEqual(result['game']['last_result']['selection_method'], 'ceo')
        self.assertEqual(sum(result['game']['vote_counts'].values()), 2)
        reading = await self.advance(30)
        self.assertEqual(reading['phase'], 'reading')
        self.assertIn(late_id, reading['game']['eligible_member_ids'])
        for index in range(2):
            voting = await self.reach('voting')
            option = voting['game']['current_node']['options'][0]['option_id']
            for player in range(4):
                await self.action(player, voting, 'vote', option_id=option)
            result = await self.advance(60)
            self.assertEqual(result['phase'], 'ended' if index == 1 else 'result')
            if index == 0:
                await self.advance(30)
        evidence = await self.clients[0].get(self.path + '/evaluation-evidence')
        self.assertEqual(evidence.status_code, 200, evidence.text)
        record = evidence.json()
        self.assertEqual(len(record['decisions']), 3)
        self.assertEqual(len(record['turns']), 11)
        frozen = await self.advance(100, alive=False)
        self.assertEqual(frozen['game']['history'], result['game']['history'])
        self.assertEqual((await self.clients[0].get(self.path + '/evaluation-evidence')).json(), record)

    async def test_thirty_concurrent_voters_replacement_and_cutoff_equality(self):
        started = await self.ready(30)
        began = datetime.fromisoformat(started['game']['started_at'])
        total = datetime.fromisoformat(started['game']['session_deadline'])
        self.assertEqual((total - began).total_seconds(), 1110)
        speaking = await self.reach('speaking')
        due = datetime.fromisoformat(speaking['game']['phase_deadline'])
        now = datetime.fromisoformat(speaking['game']['server_time'])
        self.assertEqual((due - now).total_seconds(), 5)
        self.assertEqual(len(speaking['game']['speaker_order']), 30)
        voting = await self.reach('voting')
        due = datetime.fromisoformat(voting['game']['phase_deadline'])
        now = datetime.fromisoformat(voting['game']['server_time'])
        self.assertEqual((due - now).total_seconds(), 60)
        options = voting['game']['current_node']['options']
        await asyncio.gather(*(self.action(index, voting, 'vote', option_id=options[0]['option_id'])
                               for index in range(30)))
        replaced = await self.action(0, voting, 'vote', option_id=options[1]['option_id'])
        self.assertEqual(replaced['game']['self_vote'], options[1]['option_id'])
        self.assertIsNone(replaced['game']['vote_counts'])
        state = self.rooms.rooms[self.room_id].phase.state
        self.clock.now = state.phase.deadline
        await self.action(0, voting, 'vote', expected=409, option_id=options[0]['option_id'])
        result = await self.view()
        self.assertEqual(result['game']['vote_counts'][options[0]['option_id']], 29)
        self.assertEqual(result['game']['vote_counts'][options[1]['option_id']], 1)
        self.assertEqual(len(result['game']['history']), 1)

    async def test_exact_retry_rejoin_shared_session_and_conflicting_intent(self):
        await self.ready()
        voting = await self.reach('voting')
        option = voting['game']['current_node']['options'][0]['option_id']
        body = command(phase_id=voting['game']['phase_id'], option_id=option)
        path = self.path + '/rounds/' + voting['game']['round_id'] + '/vote'
        first, duplicate = await asyncio.gather(*(self.clients[0].post(path, json=body) for _ in range(2)))
        self.assertEqual(first.status_code, 200)
        self.assertEqual(duplicate.json(), first.json())
        changed = {**body, 'option_id': voting['game']['current_node']['options'][1]['option_id']}
        self.assertEqual((await self.clients[0].post(path, json=changed)).status_code, 409)
        clone = await self.client()
        clone.headers[SESSION_HEADER] = self.clients[0].headers[SESSION_HEADER]
        recovered = await clone.get(self.path)
        self.assertEqual(recovered.json()['self_member_id'], self.ids[0])
        self.assertEqual(recovered.json()['game']['self_vote'], option)
        self.assertEqual(len(recovered.json()['members']), 3)
        result = await self.advance(60)
        self.assertEqual(sum(result['game']['vote_counts'].values()), 1)
        self.assertEqual((await self.clients[0].post(path, json=body)).json(), first.json())
        await self.action(0, voting, 'vote', expected=409, option_id=option)

    async def test_zero_votes_and_ceo_timeout_use_authored_no_decision(self):
        await self.ready()
        await self.reach('voting')
        result = await self.advance(60)
        self.assertEqual(result['game']['last_result']['resolution_kind'], 'no_decision')
        await self.advance(30)
        voting = await self.reach('voting')
        options = voting['game']['current_node']['options']
        await self.action(0, voting, 'vote', option_id=options[0]['option_id'])
        await self.action(2, voting, 'vote', option_id=options[1]['option_id'])
        tied = await self.advance(60)
        self.assertEqual(tied['phase'], 'tie_break')
        result = await self.advance(30)
        self.assertEqual(result['game']['last_result']['selection_method'], 'tie_timeout')
        self.assertEqual(result['game']['last_result']['resolution_kind'], 'no_decision')

    async def test_offline_ceo_reassignment_is_public_and_permission_checked(self):
        await self.ready()
        voting = await self.reach('voting')
        options = voting['game']['current_node']['options']
        await self.action(0, voting, 'vote', option_id=options[0]['option_id'])
        await self.action(2, voting, 'vote', option_id=options[1]['option_id'])
        tied = await self.advance(60)
        await self.action(0, tied, 'ceo-reassignment', expected=409, member_id=self.ids[2])
        # The CEO's last valid presence expires before this tie's deadline.
        room = self.rooms.rooms[self.room_id]
        token = self.clients[1].headers[SESSION_HEADER]
        room.members[token] = replace(room.members[token], last_seen=self.clock.now - 30)
        await self.action(2, tied, 'ceo-reassignment', expected=403, member_id=self.ids[2])
        changed = await self.action(0, tied, 'ceo-reassignment', member_id=self.ids[2])
        self.assertEqual(changed['game']['ceo_changes'][0]['member_id'], self.ids[2])
        self.assertEqual(sum(m['role_id'] == 'ceo' for m in changed['members']), 1)
        await self.action(1, tied, 'tie-decision', expected=403, option_id=options[0]['option_id'])
        result = await self.action(2, tied, 'tie-decision', option_id=options[1]['option_id'])
        self.assertEqual(result['phase'], 'result')

    async def test_total_timeout_precedence_end_before_decisions_and_frozen_names(self):
        await self.ready()
        voting = await self.reach('voting')
        room = self.rooms.rooms[self.room_id]
        room.phase = replace(room.phase, state=replace(room.phase.state,
                             session_deadline=room.phase.state.phase.deadline))
        ended = await self.advance(60)
        self.assertEqual(ended['phase'], 'ended')
        self.assertEqual(ended['game']['ending_label'], 'total_timeout')
        self.assertEqual(ended['game']['history'], [])
        evidence = await self.clients[1].get(self.path + '/evaluation-evidence')
        self.assertEqual(evidence.status_code, 200, evidence.text)
        renamed = await self.clients[0].post('/api/rooms/join', json=command(
            room_code='PLAY01', display_name='New name'))
        self.assertEqual(renamed.status_code, 409)
        self.assertIsNotNone(evidence.json()['ended_at'])

    async def test_host_end_permissions_stale_command_and_unauthorized_room(self):
        view = await self.ready()
        body = command(phase_id=view['game']['phase_id'])
        self.assertEqual((await self.clients[1].post(self.path + '/end', json=body)).status_code, 403)
        stranger = await self.client()
        self.assertEqual((await stranger.get(self.path)).status_code, 403)
        self.assertEqual((await stranger.post(self.path + '/end', json=body)).status_code, 403)
        ended = await self.clients[0].post(self.path + '/end', json=body)
        self.assertEqual(ended.status_code, 200, ended.text)
        self.assertEqual(ended.json()['game']['ending_label'], 'host_ended')
        self.assertEqual((await self.clients[0].post(self.path + '/end', json=body)).json(), ended.json())
        self.assertEqual((await self.clients[0].get(self.path + '/evaluation-evidence')).status_code, 200)

    async def test_clock_advances_without_requests_and_old_ticks_do_not_repeat(self):
        await self.ready()
        async with self.app.router.lifespan_context(self.app):
            self.clock.now += 90
            # Keep the host connected while exercising phase scheduling without commands.
            room = self.rooms.rooms[self.room_id]
            token = self.clients[0].headers[SESSION_HEADER]
            room.members[token] = replace(room.members[token], last_seen=self.clock.now)
            await asyncio.sleep(0.15)
            self.assertEqual(self.rooms.rooms[self.room_id].phase.state.phase.kind, 'reading')
            version = self.rooms.rooms[self.room_id].version
            await self.rooms.tick()
            self.assertEqual(self.rooms.rooms[self.room_id].version, version)
            self.clock.now += 10000
            room.members[token] = replace(room.members[token], last_seen=self.clock.now)
            await asyncio.sleep(0.15)
            state = self.rooms.rooms[self.room_id].phase.state
            self.assertEqual(state.phase.kind, 'ended')
            history = state.history
            await self.rooms.tick()
            self.assertEqual(self.rooms.rooms[self.room_id].phase.state.history, history)
            task = self.app.state.clock_task
        self.assertTrue(task.cancelled())

    async def test_guest_disconnect_during_slot_skips_once_and_keeps_vote_eligibility(self):
        await self.ready()
        speaking = await self.reach('speaking')
        await self.action(0, speaking, 'speaker/finish')
        speaking = await self.view()
        room = self.rooms.rooms[self.room_id]
        guest_token = self.clients[1].headers[SESSION_HEADER]
        room.members[guest_token] = replace(room.members[guest_token], last_seen=self.clock.now - 29)
        self.clock.now += 1
        await self.rooms.tick()
        recovered = await self.view()
        self.assertEqual(recovered['game']['active_speaker_id'], self.ids[2])
        self.assertEqual(len(recovered['game']['turns']), 2)
        self.assertEqual(recovered['game']['turns'][1]['reason'], 'disconnected')
        await self.rooms.tick()
        self.assertEqual(len((await self.view())['game']['turns']), 2)
        self.assertIn(self.ids[1], recovered['game']['eligible_member_ids'])
        await self.action(1, speaking, 'speaker/finish', expected=409)

    async def test_late_start_retry_reconciles_before_refreshing_presence(self):
        await self.ready()
        await self.advance(149)
        self.clock.now += 2
        retry = await self.clients[0].post(self.path + '/start', json=self.start_body)
        self.assertEqual(retry.status_code, 200, retry.text)
        current = await self.view()
        self.assertEqual(current['phase'], 'speaking')
        self.assertEqual(current['game']['active_speaker_id'], self.ids[0])
        self.assertEqual(current['game']['turns'], [])

    async def test_late_create_retry_reconciles_before_refreshing_presence(self):
        await self.ready()
        await self.advance(149)
        self.clock.now += 2
        retry = await self.clients[0].post('/api/rooms', json=self.create_body)
        self.assertEqual(retry.status_code, 201, retry.text)
        current = await self.view()
        self.assertEqual(current['phase'], 'speaking')
        self.assertEqual(current['game']['active_speaker_id'], self.ids[0])
        self.assertEqual(current['game']['turns'], [])

    async def test_total_timeout_earlier_than_phase_and_overdue_transitions(self):
        await self.ready()
        room = self.rooms.rooms[self.room_id]
        room.phase = replace(room.phase, state=replace(room.phase.state,
                             session_deadline=self.clock.now + 20))
        self.clock.now += 1000
        await self.rooms.tick()
        ended = await self.view()
        self.assertEqual(ended['game']['ending_label'], 'total_timeout')
        self.assertEqual(ended['game']['history'], [])
        self.assertEqual(ended['game']['turns'], [])

    async def test_absent_host_closes_the_call_and_prevents_rejoin(self):
        await self.ready()
        self.clock.now += 300
        await self.rooms.tick()
        current = await self.clients[0].get(self.path)
        self.assertEqual(current.status_code, 410)
        self.assertEqual(current.json()['detail']['code'], 'host_disconnected')
        recovered = await self.clients[0].post('/api/rooms/join', json=command(
            room_code='PLAY01', display_name='Player 0'))
        self.assertEqual(recovered.status_code, 410, recovered.text)
        self.assertEqual(self.rooms.rooms[self.room_id].phase.state.phase.kind, 'ended')

    async def test_old_round_speaker_command_and_repeated_tick_cannot_skip_new_turn(self):
        await self.ready()
        old = await self.reach('speaking')
        await self.reach('voting')
        await self.advance(60)
        await self.advance(30)
        new = await self.reach('speaking')
        self.assertNotEqual(old['game']['round_id'], new['game']['round_id'])
        await self.action(0, old, 'speaker/finish', expected=409)
        version = (await self.view())['room_version']
        await asyncio.gather(*(self.rooms.tick() for _ in range(8)))
        current = await self.view()
        self.assertEqual(current['room_version'], version)
        self.assertEqual(current['game']['active_speaker_id'], new['game']['active_speaker_id'])

    async def test_gameplay_rooms_isolate_rounds_votes_history_and_timers(self):
        await self.ready()
        second_ids = []
        for index, client in enumerate(self.clients):
            response = await client.post('/api/rooms' if index == 0 else '/api/rooms/join',
                json=command(room_code='OTHER1', display_name=f'Other {index}'))
            self.assertIn(response.status_code, (200, 201), response.text)
            second_ids.append(response.json()['self_member_id'])
        other_path = '/api/rooms/' + response.json()['room_id']
        started = await self.clients[0].post(other_path + '/start', json=command(
            room_code='OTHER1', scenario_id='maplecart_cybersecurity', scenario_version=3,
            timing_profile='standard_18', players=[
                {'member_id': member, 'role_id': 'ceo' if index == 1 else 'security'}
                for index, member in enumerate(second_ids)]))
        self.assertEqual(started.status_code, 200, started.text)
        first = await self.reach('voting')
        second = (await self.clients[1].get(other_path)).json()
        self.assertEqual(second['phase'], 'voting')
        first_option = first['game']['current_node']['options'][0]['option_id']
        second_option = second['game']['current_node']['options'][1]['option_id']
        await asyncio.gather(
            self.action(0, first, 'vote', option_id=first_option),
            self.clients[1].post(other_path + '/rounds/' + second['game']['round_id'] + '/vote',
                json=command(phase_id=second['game']['phase_id'], option_id=second_option)))
        self.clock.now += 60
        # Both hosts remain connected; only phase deadlines are under test here.
        for active_room in self.rooms.rooms.values():
            token = self.clients[0].headers[SESSION_HEADER]
            active_room.members[token] = replace(active_room.members[token], last_seen=self.clock.now)
        await asyncio.gather(*(self.rooms.tick() for _ in range(3)))
        first = await self.view()
        second = (await self.clients[1].get(other_path)).json()
        self.assertEqual(first['game']['last_result']['selected_option_id'], first_option)
        self.assertEqual(second['game']['last_result']['selected_option_id'], second_option)
        self.assertNotEqual(first['game']['history'][0]['decision_id'], second['game']['history'][0]['decision_id'])
        self.assertNotEqual(first['self_member_id'], second['self_member_id'])
        self.assertEqual(sum(first['game']['vote_counts'].values()), 1)
        self.assertEqual(sum(second['game']['vote_counts'].values()), 1)

    async def test_host_end_invalidates_old_consequence_narration(self):
        await self.ready()
        await self.reach('voting')
        result = await self.advance(60)
        narration_id = result['game']['narration']['narration_id']
        ended = await self.clients[0].post(self.path + '/end', json=command(
            phase_id=result['game']['phase_id']))
        self.assertEqual(ended.status_code, 200, ended.text)
        self.assertIsNone(ended.json()['game']['narration'])
        expired = await self.clients[0].get(self.path + '/narration/' + narration_id)
        self.assertEqual(expired.status_code, 410)

    async def test_chat_survives_every_gameplay_phase_and_retries_after_ending(self):
        view = await self.ready()
        expected, intents = [], []

        async def chat(current):
            body = command(phase_id=current['game']['phase_id'], kind='chat',
                           source='typed', text='Discussion during ' + current['phase'])
            response = await self.clients[2].post(self.path + '/contributions', json=body)
            self.assertEqual(response.status_code, 201, response.text)
            record = response.json()
            self.assertEqual(record['phase'], current['phase'])
            self.assertEqual(record['member_id'], self.ids[2])
            self.assertEqual(record['role_id'], 'security')
            self.assertEqual(record['round_id'], current['game']['round_id'])
            expected.append(record)
            intents.append((body, record))

        await chat(view)
        reading = await self.reach('reading')
        await chat(reading)
        speaking = await self.reach('speaking')
        await chat(speaking)
        for index in range(3):
            speaking = await self.action(index, speaking, 'speaker/finish')
        self.assertEqual(speaking['phase'], 'discussion')
        await chat(speaking)
        voting = await self.reach('voting')
        await chat(voting)
        options = voting['game']['current_node']['options']
        await self.action(0, voting, 'vote', option_id=options[0]['option_id'])
        await self.action(1, voting, 'vote', option_id=options[1]['option_id'])
        tied = await self.advance(60)
        self.assertEqual(tied['phase'], 'tie_break')
        await chat(tied)
        result = await self.action(1, tied, 'tie-decision', option_id=options[0]['option_id'])
        await chat(result)
        self.assertEqual(set(result['game']['last_result']['contribution_ids']),
                         {item['contribution_id'] for item in expected[:-1]})
        self.assertEqual(sum(result['game']['vote_counts'].values()), 2)

        await self.advance(30)
        speaking = await self.reach('speaking')
        proposal = await self.action(0, speaking, 'proposal', text='Preserve the original logs.')
        expected.append((await self.clients[0].get(self.path + '/contributions')).json()[-1])
        option_id = proposal['game']['proposals'][0]['option_id']
        voting = await self.reach('voting')
        await self.action(0, voting, 'vote', option_id=option_id)
        resolving = await self.advance(60)
        self.assertEqual(resolving['phase'], 'resolving')
        await chat(resolving)
        failed = await self.advance(15)
        self.assertEqual(failed['phase'], 'resolution_failed')
        await chat(failed)

        ended = await self.clients[0].post(self.path + '/end', json=command(
            phase_id=failed['game']['phase_id']))
        self.assertEqual(ended.status_code, 200, ended.text)
        frozen = (await self.clients[0].get(self.path + '/evaluation-evidence')).json()
        self.assertEqual(frozen['contributions'], expected)
        for body, original in intents:
            recovered = await self.clients[2].post(self.path + '/contributions', json=body)
            self.assertEqual(recovered.status_code, 201, recovered.text)
            self.assertEqual(recovered.json(), original)
        rejected = await self.clients[2].post(self.path + '/contributions', json=command(
            phase_id=ended.json()['game']['phase_id'], kind='chat', source='typed', text='Too late'))
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.json()['detail']['code'], 'game_ended')
        self.assertEqual((await self.clients[1].get(self.path + '/contributions')).json(), expected)
        self.assertEqual((await self.clients[1].get(self.path + '/evaluation-evidence')).json(), frozen)


if __name__ == '__main__':
    unittest.main()
