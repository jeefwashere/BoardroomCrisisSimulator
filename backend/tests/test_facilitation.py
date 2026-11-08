"""Advisory facilitation never changes game state; recorded clips are a fixed public catalog."""

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from uuid import uuid4

from backend.app.facilitation import Facilitation, IncidentDocuments, RecordedClips, speakable
from backend.app.main import create_app
from backend.app.narration import NarrationService
from backend.app.rooms import Rooms
from backend.app.scenarios import ScenarioCatalog
from backend.tests import test_gameplay as fixture


class Provider:
    def __init__(self, configured=True, fail=False):
        self.configured, self.fail, self.prompts = configured, fail, []
        self.gate = asyncio.Event()
        self.gate.set()

    async def run(self, prompt, request_id, timeout):
        self.prompts.append(prompt)
        await self.gate.wait()
        if self.fail:
            raise RuntimeError('private provider detail')
        return 'Hosted advisory reply.'


class FacilitationTests(unittest.IsolatedAsyncioTestCase):
    client, view = fixture.GameplayTests.client, fixture.GameplayTests.view
    _ready = fixture.GameplayTests.ready

    async def asyncSetUp(self):
        await fixture.GameplayTests.asyncSetUp(self)
        self.use(Provider())

    def use(self, provider):
        self.provider = provider
        self.facilitation = Facilitation(self.rooms, provider, NarrationService())
        self.app = create_app(rooms=self.rooms, facilitation_service=self.facilitation)

    async def ready(self, code='PLAY01'):
        result = await self._ready(code=code)
        self.facilitation_path = self.path + '/facilitation'
        return result

    async def settle(self, index=0):
        for _ in range(100):
            body = (await self.clients[index].get(self.facilitation_path)).json()
            items = [body['opening'], *body['consultations']]
            if all(item['status'] != 'pending' for item in items):
                return body
            await asyncio.sleep(0.01)
        self.fail('Facilitation jobs did not finish')

    async def test_lobby_has_no_opening_and_opening_is_generated_once(self):
        client = await self.client()
        created = (await client.post('/api/rooms', json=fixture.command(room_code='LOBBY1', display_name='Host'))).json()
        lobby = (await client.get(f"/api/rooms/{created['room_id']}/facilitation")).json()
        self.assertIsNone(lobby['opening'])
        self.assertEqual([item['kind'] for item in lobby['advisers']], ['facilitator', 'it', 'journalist'])

        # Start begins the opening job, so hold the provider from before Start.
        self.provider.gate.clear()
        before = await self.ready()
        first = await asyncio.gather(*(client.get(self.facilitation_path) for client in self.clients))
        self.assertTrue(all(response.json()['opening']['status'] == 'pending' for response in first))
        self.provider.gate.set()
        body = await self.settle(2)
        self.assertEqual(len(self.provider.prompts), 1)
        self.assertEqual(body['opening']['source'], 'hosted')
        self.assertEqual(body['opening']['text'], 'Hosted advisory reply.')
        self.assertIsNotNone(body['opening']['speech_id'])
        self.assertIn(before['game']['scenario']['title'], self.provider.prompts[0])
        self.assertEqual((await self.view())['game']['phase_id'], before['game']['phase_id'])

    async def test_opening_starts_at_game_start_before_any_poll(self):
        await self.ready()
        for _ in range(100):
            if self.provider.prompts and self.facilitation.openings.get(self.room_id, {}).get('status') == 'ready':
                break
            await asyncio.sleep(0.01)
        self.assertEqual(len(self.provider.prompts), 1)
        self.assertIn('55 to 70 words', self.provider.prompts[0])
        body = (await self.clients[1].get(self.facilitation_path)).json()
        self.assertEqual(body['opening']['status'], 'ready')
        self.assertEqual(len(self.provider.prompts), 1)

    async def test_opening_hedges_a_hung_vertex_request(self):
        class Vertex:
            configured = True

            def __init__(self, plan):
                self.plan, self.calls = list(plan), 0

            async def text(self, prompt, timeout, cap):
                kind = self.plan[self.calls]
                self.calls += 1
                if kind == 'hang':
                    await asyncio.sleep(30)
                if kind == 'fail':
                    raise RuntimeError('private provider detail')
                return f'Vertex answer {self.calls}.'

        timing = {'HEDGE_STARTS': (0.0, 0.05, 0.1), 'HEDGE_DEADLINE': 0.3}
        with mock.patch.multiple('backend.app.facilitation', **timing):
            for plan, expected, calls in ((['hang', 'ok'], ('Vertex answer 2.', 'vertex'), 2),
                                          (['fail', 'ok'], ('Vertex answer 2.', 'vertex'), 2),
                                          (['hang', 'hang', 'ok'], ('Vertex answer 3.', 'vertex'), 3),
                                          (['hang', 'hang', 'hang'], ('offline text', 'offline'), 3)):
                with self.subTest(plan=plan):
                    vertex = Vertex(plan)
                    service = Facilitation(self.rooms, Provider(configured=False), NarrationService(), vertex=vertex)
                    result = await asyncio.wait_for(service.generate('prompt', 'offline text', hedged=True), 2)
                    self.assertEqual(result, expected)
                    self.assertEqual(vertex.calls, calls)
            # Other lines keep one plain request.
            vertex = Vertex(['ok'])
            service = Facilitation(self.rooms, Provider(configured=False), NarrationService(), vertex=vertex)
            self.assertEqual(await service.generate('prompt', 'offline text'), ('Vertex answer 1.', 'vertex'))

    async def test_offline_fallback_when_unconfigured_or_failing(self):
        for code, provider in (('OFFLN1', Provider(configured=False)), ('OFFLN2', Provider(fail=True))):
            with self.subTest(configured=provider.configured):
                self.clients, self.ids = [], []
                self.use(provider)
                view = await self.ready(code)
                await self.clients[0].get(self.facilitation_path)
                body = await self.settle()
                opening = body['opening']
                self.assertEqual(opening['status'], 'ready')
                self.assertEqual(opening['source'], 'offline')
                self.assertIn('Offline facilitator briefing', opening['text'])
                self.assertNotIn('private provider', opening['text'])
                self.assertIn(view['game']['scenario']['title'], opening['text'])
                consult = await self.clients[1].post(self.facilitation_path + '/consult', json=fixture.command(
                    kind='it', question='Is the backup verified?'))
                self.assertEqual(consult.status_code, 200, consult.text)
                body = await self.settle()
                self.assertEqual(body['consultations'][-1]['source'], 'offline')
                self.assertIn('Offline it adviser note', body['consultations'][-1]['reply'])
                self.assertIn('Attached incident report, Service outage and unavailable director', opening['text'])
                self.assertIn('Attached incident report', body['consultations'][-1]['reply'])
                speech = await self.clients[0].post(
                    self.facilitation_path + f"/speech/{opening['speech_id']}/prepare")
                self.assertEqual(speech.json(), {'status': 'disabled', 'error': None})
                audio = await self.clients[0].get(self.facilitation_path + f"/speech/{opening['speech_id']}/audio")
                self.assertEqual(audio.status_code, 404)

    async def test_consult_idempotent_one_pending_and_members_only(self):
        await self.ready()
        self.provider.gate.clear()
        body = fixture.command(kind='journalist', question='What can we say publicly?')
        first = await self.clients[0].post(self.facilitation_path + '/consult', json=body)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()['status'], 'pending')
        retry = await self.clients[0].post(self.facilitation_path + '/consult', json=body)
        self.assertEqual(retry.json()['consultation_id'], first.json()['consultation_id'])
        conflict = await self.clients[0].post(self.facilitation_path + '/consult', json={**body, 'question': 'Other?'})
        self.assertEqual(conflict.json()['detail']['code'], 'command_conflict')
        second = await self.clients[0].post(self.facilitation_path + '/consult', json=fixture.command(
            kind='facilitator', question='Summarize.'))
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json()['detail']['code'], 'consultation_pending')
        other = await self.clients[1].post(self.facilitation_path + '/consult', json=fixture.command(
            kind='facilitator', question='Summarize.'))
        self.assertEqual(other.status_code, 200)

        outsider = await self.client()
        rejected = await outsider.post(self.facilitation_path + '/consult', json=fixture.command(
            kind='it', question='Hello?'))
        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(rejected.json()['detail']['code'], 'not_a_member')
        self.assertEqual((await outsider.get(self.facilitation_path)).status_code, 403)

        self.provider.gate.set()
        shared = await self.settle(2)
        self.assertEqual(len(shared['consultations']), 2)
        self.assertEqual({item['status'] for item in shared['consultations']}, {'ready'})
        item = shared['consultations'][0]
        self.assertEqual(item['speech_id'], item['consultation_id'])
        self.assertEqual(item['member_id'], self.ids[0])
        again = await self.clients[0].post(self.facilitation_path + '/consult', json=fixture.command(
            kind='it', question='And the backups?'))
        self.assertEqual(again.status_code, 200)
        invalid = await self.clients[0].post(self.facilitation_path + '/consult', json=fixture.command(
            kind='oracle', question='Vote for us'))
        self.assertEqual(invalid.status_code, 422)


    async def test_default_report_attached_and_grounds_prompts(self):
        await self.ready()
        await self.clients[0].get(self.facilitation_path)
        body = await self.settle()
        self.assertEqual(body['documents'], [{'document_id': 't01_service_outage',
                                              'title': 'Service outage and unavailable director',
                                              'pdf_url': '/api/documents/t01_service_outage/pdf'}])
        consult = await self.clients[1].post(self.facilitation_path + '/consult', json=fixture.command(
            kind='it', question='x' * 1000))
        self.assertEqual(consult.status_code, 200, consult.text)
        await self.settle()
        self.assertEqual(len(self.provider.prompts), 2)
        for prompt in self.provider.prompts:
            self.assertLessEqual(len(prompt), 4000)
            self.assertIn('"label": "Attached incident report"', prompt)
            self.assertIn('Cedar Bridge Community Services', prompt)
            self.assertNotIn('controller', prompt.lower())
        self.assertIn('BCP-4', self.provider.prompts[0])
        self.assertIn('restorability has not been checked', self.provider.prompts[0])

    def test_grounding_reads_only_participant_packs(self):
        opened = []
        for name in ('read_text', 'read_bytes'):
            original = getattr(Path, name)
            def record(path, *args, _original=original, **kwargs):
                opened.append(str(path))
                return _original(path, *args, **kwargs)
            self.enterContext(mock.patch.object(Path, name, record))
        documents = IncidentDocuments()
        documents.pdf('t01_service_outage')
        self.assertTrue(opened)
        self.assertTrue(all('controller' not in path for path in opened), opened)
        self.assertEqual({Path(path).name for path in opened}, {'participant-packs.json', 'demo-t01-service-outage.pdf'})
        text = repr(documents.grounding())
        self.assertIn('T01-BCP', text)
        self.assertNotIn('T02', text)
        self.assertNotIn('common three-person rules apply', text)


CEDAR_ROLES = ('ceo', 'technology', 'communications')
ANSWERS = ('Appoint the deputy as interim coordinator today and authorize paper appointments.',
           'IT has not tested the backup restore, so nobody should promise a reopening time.',
           'Tell clients what is confirmed now and commit to the next update at noon.')


class ExpertPanelTests(unittest.IsolatedAsyncioTestCase):
    client, view, action = fixture.GameplayTests.client, fixture.GameplayTests.view, fixture.GameplayTests.action

    async def asyncSetUp(self):
        self.clock = fixture.Clock()
        self.clock.now = 1000.0
        self.rooms = Rooms(ScenarioCatalog(), self.clock)
        self.clients, self.ids = [], []
        self.use(Provider())

    def use(self, provider):
        self.provider = provider
        self.facilitation = Facilitation(self.rooms, provider, NarrationService())
        self.app = create_app(rooms=self.rooms, facilitation_service=self.facilitation)

    def expert_prompts(self):
        return [prompt for prompt in self.provider.prompts if 'expert panel' in prompt]

    async def cedar(self, code='CEDAR1'):
        for number in range(3):
            client = await self.client()
            self.clients.append(client)
            response = await client.post('/api/rooms' if number == 0 else '/api/rooms/join',
                                         json=fixture.command(room_code=code, display_name=f'Player {number}'))
            self.assertIn(response.status_code, (200, 201), response.text)
            self.ids.append(response.json()['self_member_id'])
        self.path = '/api/rooms/' + response.json()['room_id']
        self.facilitation_path = self.path + '/facilitation'
        response = await self.clients[0].post(self.path + '/start', json=fixture.command(
            room_code=code, scenario_id='cedar_bridge_t01', scenario_version=1, timing_profile='standard_18',
            ballot_source='authored', players=[{'member_id': member, 'role_id': role}
                                               for member, role in zip(self.ids, CEDAR_ROLES)]))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def to_panel(self, early_get=False, code='CEDAR1'):
        view = await self.action(0, await self.cedar(code), 'briefing/finish')
        self.assertEqual(view['phase'], 'speaking')
        self.assertEqual(view['game']['discussion_mode'], 'experts')
        if early_get:
            body = (await self.clients[0].get(self.facilitation_path)).json()
            self.assertIsNone(body['expert_panel'])
        # Cedar goes round the table three times: nine turns, each member speaking three times in order.
        self.assertEqual(view['game']['speaker_order'], self.ids[:3] * 3)
        for turn in range(9):
            self.assertEqual(view['game']['speaker_index'], turn)
            answer = ANSWERS[turn % len(ANSWERS)]
            index = self.ids.index(view['game']['active_speaker_id'])
            self.assertEqual(index, turn % 3)
            saved = await self.clients[index].post(self.path + '/contributions', json=fixture.command(
                phase_id=view['game']['phase_id'], kind='answer', source='typed', text=answer))
            self.assertEqual(saved.status_code, 201, saved.text)
            view = await self.action(index, view, 'speaker/finish')
        return view

    async def settle(self, index=0):
        for _ in range(100):
            body = (await self.clients[index].get(self.facilitation_path)).json()
            if body['expert_panel'] is not None and body['expert_panel']['status'] == 'ready':
                return body
            await asyncio.sleep(0.01)
        self.fail('Expert panel did not finish')

    async def test_expert_stage_follows_last_turn_for_exactly_ninety_seconds(self):
        view = await self.to_panel()
        self.assertEqual(view['phase'], 'discussion')
        game = view['game']
        self.assertEqual(game['discussion_mode'], 'experts')
        remaining = (fixture.datetime.fromisoformat(game['phase_deadline'])
                     - fixture.datetime.fromisoformat(game['server_time'])).total_seconds()
        self.assertEqual(remaining, 90)
        self.assertIn('skip_phase', (await self.view())['game']['allowed_actions'])
        self.clock.now += 89
        self.assertEqual((await self.view())['phase'], 'discussion')
        self.clock.now += 1
        # Cedar Bridge records individual decisions instead of voting.
        self.assertEqual((await self.view())['phase'], 'individual_decision')

    async def test_three_grounded_experts_generated_once_for_concurrent_readers(self):
        await self.to_panel(early_get=True)
        self.provider.gate.clear()
        first = await asyncio.gather(*(client.get(self.facilitation_path) for client in self.clients))
        panels = [response.json()['expert_panel'] for response in first]
        self.assertTrue(all(panel['status'] == 'pending' for panel in panels))
        self.assertEqual(len({panel['round_id'] for panel in panels}), 1)
        self.assertEqual(panels[0]['round_id'], (await self.view())['game']['round_id'])
        self.provider.gate.set()
        body = await self.settle(2)
        await self.clients[1].get(self.facilitation_path)
        prompts = self.expert_prompts()
        self.assertEqual(len(prompts), 3)
        panel = body['expert_panel']
        self.assertEqual([item['kind'] for item in panel['experts']], ['security', 'operations', 'governance'])
        self.assertEqual([item['label'] for item in panel['experts']],
                         ['IT and security', 'Operations and community services', 'Governance and finance'])
        for item in panel['experts']:
            self.assertEqual(set(item), {'kind', 'label', 'status', 'text', 'source', 'speech_id', 'error'})
            self.assertEqual((item['status'], item['source'], item['text'], item['error']),
                             ('ready', 'hosted', 'Hosted advisory reply.', None))
        self.assertEqual(len({item['speech_id'] for item in panel['experts']}), 3)
        for prompt in prompts:
            self.assertLessEqual(len(prompt), 4000)
            self.assertIn(ANSWERS[1], prompt)
            self.assertIn('Player 1', prompt)
            self.assertIn('IT recovery lead', prompt)
            self.assertIn('What must IT verify', prompt)
            self.assertIn('"label": "Attached incident report"', prompt)
            self.assertNotIn('controller', prompt.lower())
        security, operations, governance = prompts_by_kind = (
            next(prompt for prompt in prompts if 'IT and security expert' in prompt),
            next(prompt for prompt in prompts if 'operations and community services expert' in prompt),
            next(prompt for prompt in prompts if 'governance and finance expert' in prompt))
        self.assertIn('technically known', security)
        self.assertIn('staff', operations)
        self.assertIn('authorize', governance)
        self.assertEqual(len(set(prompts_by_kind)), 3)
        speech_id = panel['experts'][1]['speech_id']
        prepared = await self.clients[0].post(self.facilitation_path + f'/speech/{speech_id}/prepare')
        self.assertEqual(prepared.json(), {'status': 'disabled', 'error': None})
        self.assertEqual((await self.view())['phase'], 'discussion')

    async def test_offline_fallback_per_expert(self):
        for code, provider in (('EXOFF1', Provider(configured=False)), ('EXOFF2', Provider(fail=True))):
            with self.subTest(configured=provider.configured):
                self.clients, self.ids = [], []
                self.use(provider)
                await self.to_panel(code=code)
                await self.clients[0].get(self.facilitation_path)
                experts = (await self.settle())['expert_panel']['experts']
                self.assertEqual({item['source'] for item in experts}, {'offline'})
                self.assertIn('Offline IT and security take', experts[0]['text'])
                self.assertIn('Offline operations and community services take', experts[1]['text'])
                self.assertIn('Offline governance and finance take', experts[2]['text'])
                for item in experts:
                    self.assertIn('Player 0 (CEO) said:', item['text'])
                    self.assertNotIn('private provider', item['text'])
                    self.assertTrue(40 <= len(item['text'].split()) <= 130, item['text'])

    async def test_host_skip_from_expert_stage_opens_individual_decisions_and_panel_remains(self):
        view = await self.to_panel()
        await self.clients[0].get(self.facilitation_path)
        before = (await self.settle())['expert_panel']
        await self.action(1, view, 'skip-phase', expected=403)
        decision = await self.action(0, view, 'skip-phase')
        self.assertEqual(decision['phase'], 'individual_decision')
        after = (await self.clients[2].get(self.facilitation_path)).json()['expert_panel']
        self.assertEqual(after, before)
        self.assertEqual(len(self.expert_prompts()), 3)

    async def test_other_scenarios_keep_open_discussion_and_no_panel(self):
        await fixture.GameplayTests.ready(self)
        self.facilitation_path = self.path + '/facilitation'
        view = await self.action(0, await self.view(), 'briefing/finish')
        while view['phase'] == 'speaking':
            self.assertEqual(view['game']['discussion_mode'], 'open')
            view = await self.action(self.ids.index(view['game']['active_speaker_id']), view, 'speaker/finish')
        self.assertEqual(view['phase'], 'discussion')
        self.assertEqual(view['game']['discussion_mode'], 'open')
        self.assertIsNone((await self.clients[0].get(self.facilitation_path)).json()['expert_panel'])

    def test_speakable_strips_markdown_and_bounds_length(self):
        self.assertEqual(speakable('## Take\n- **Verify** the backup.\n2. Check `logs`.'),
                         'Take Verify the backup. Check logs.')
        long = ' '.join(['Word'] * 80 + ['end.'] + ['more'] * 80)
        self.assertTrue(speakable(long).endswith('end.'))


class DocumentCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.GameplayTests.asyncSetUp(self)

    async def test_catalog_pdf_and_traversal(self):
        client = await self.enterAsyncContext(fixture.httpx.AsyncClient(
            transport=fixture.httpx.ASGITransport(app=self.app), base_url='http://test'))
        catalog = await client.get('/api/documents', headers={'Origin': 'http://localhost:5173'})
        self.assertEqual(catalog.status_code, 200)
        self.assertEqual(catalog.headers.get('access-control-allow-origin'), 'http://localhost:5173')
        items = catalog.json()
        self.assertEqual([item['document_id'] for item in items],
                         ['t01_service_outage', 't02_fundraising', 't03_succession_payroll'])
        self.assertEqual([item['pack'] for item in items], ['T01', 'T02', 'T03'])
        self.assertEqual([item['default'] for item in items], [True, False, False])
        first = items[0]
        self.assertEqual(set(first), {'document_id', 'title', 'filename', 'pack', 'default', 'summary', 'pdf_url'})
        self.assertEqual(first['title'], 'Service outage and unavailable director')
        self.assertEqual(first['filename'], 'demo-t01-service-outage.pdf')
        self.assertTrue(all(item['summary'] for item in items))
        for item in items:
            pdf = await client.get(item['pdf_url'], headers={'Origin': 'http://localhost:5173'})
            self.assertEqual(pdf.status_code, 200)
            self.assertEqual(pdf.headers['content-type'], 'application/pdf')
            self.assertEqual(pdf.headers['content-disposition'], f'inline; filename="{item["filename"]}"')
            self.assertEqual(pdf.headers.get('access-control-allow-origin'), 'http://localhost:5173')
            self.assertTrue(pdf.content.startswith(b'%PDF'))
        unknown = await client.get('/api/documents/unknown_doc/pdf')
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(unknown.json()['detail']['code'], 'document_not_found')
        for bad in ('..%2F..%2Fplaytest%2Ffixtures%2Frevision2-controller-reference.md', '%2E%2E',
                    'demo-t01-service-outage.pdf', 'T01', '..', 't01_service_outage%2F..'):
            response = await client.get(f'/api/documents/{bad}/pdf')
            self.assertEqual(response.status_code, 404, bad)
            self.assertNotIn(b'%PDF', response.content)
        self.assertEqual(IncidentDocuments(directory=self.enterContext(tempfile.TemporaryDirectory())).listing(), [])


class RecordingCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.GameplayTests.asyncSetUp(self)

    async def test_catalog_audio_and_traversal(self):
        client = await self.enterAsyncContext(fixture.httpx.AsyncClient(
            transport=fixture.httpx.ASGITransport(app=self.app), base_url='http://test'))
        catalog = (await client.get('/api/recordings', headers={'Origin': 'http://localhost:5173'}))
        self.assertEqual(catalog.status_code, 200)
        self.assertEqual(catalog.headers.get('access-control-allow-origin'), 'http://localhost:5173')
        clips = {item['clip_id']: item for item in catalog.json()}
        self.assertEqual(len(clips), 67)
        self.assertEqual(clips['t01_dialogue_09']['group'], 'discussion')
        self.assertEqual(clips['r2_member_1_step_1']['group'], 'private_coaching')
        self.assertEqual(clips['r3_member_3_step_3']['group'], 'private_assessment')
        self.assertEqual(clips['t01_decision_prompt']['group'], 'decision_guide')
        self.assertEqual(clips['t01_decision_prompt']['label'], 'Recorded decision guide')
        self.assertEqual(clips['t01_recovery_turn']['group'], 'participant')
        self.assertEqual(clips['it_dependencies']['group'], 'adviser')
        self.assertEqual({item['group'] for item in clips.values()}, {
            'decision_guide', 'participant', 'facilitator', 'adviser', 'journalist', 'discussion', 'control', 'reference',
            'private_coaching', 'private_assessment'})
        self.assertGreater(clips['t01_decision_prompt']['duration_seconds'], 0)
        audio = await client.get(clips['facilitator_open']['audio_url'])
        self.assertEqual(audio.status_code, 200)
        self.assertEqual(audio.headers['content-type'], 'audio/mpeg')
        self.assertGreater(len(audio.content), 1000)
        for bad in ('..%2Fmanifest', 'manifest', '%2E%2E', 'unknown_clip', 'facilitator_open.mp3'):
            response = await client.get(f'/api/recordings/{bad}/audio')
            self.assertEqual(response.status_code, 404, bad)
        self.assertEqual(RecordedClips(directory=self.enterContext(__import__('tempfile').TemporaryDirectory())).listing(), [])


if __name__ == '__main__':
    unittest.main()
