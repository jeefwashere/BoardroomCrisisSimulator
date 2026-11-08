"""Advisory facilitation never changes game state; recorded clips are a fixed public catalog."""

import asyncio
import unittest
from uuid import uuid4

from backend.app.facilitation import Facilitation, RecordedClips
from backend.app.main import create_app
from backend.app.narration import NarrationService
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

        before = await self.ready()
        self.provider.gate.clear()
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
        self.assertEqual(len(clips), 40)
        self.assertEqual(clips['t01_decision_prompt']['group'], 'decision_guide')
        self.assertEqual(clips['t01_decision_prompt']['label'], 'Recorded decision guide')
        self.assertEqual(clips['t01_recovery_turn']['group'], 'participant')
        self.assertEqual(clips['it_dependencies']['group'], 'adviser')
        self.assertEqual({item['group'] for item in clips.values()}, {
            'decision_guide', 'participant', 'facilitator', 'adviser', 'journalist', 'discussion', 'control', 'reference'})
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
