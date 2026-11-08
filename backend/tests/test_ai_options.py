"""Agent drafted ballot options and the Vertex provider, with fakes only (no network)."""

import asyncio
import io
import json
import os
import tempfile
import unittest
import unittest.mock
from pathlib import Path

from backend.app import simulation as sim
from backend.app.ai_options import InvalidOptions, validate
from backend.app.main import create_app
from backend.app.vertex_text import VertexText, parse_json_object
from backend.tests import test_gameplay as fixture

os.environ["BOARDROOM_VERTEX_ENABLED"] = "false"

OUTCOMES = {"O1": "targeted_containment", "O2": "delayed_containment", "O3": "broad_shutdown"}


def drafted(tag, labels=None):
    labels = labels or [f"{tag} option {index}: coordinate the board response" for index in range(1, 4)]
    return {"options": [{"label": label, "description": f"Draft {tag} describing the action in one sentence for the board.",
                         "outcome": f"O{index + 1}", "rationale": f"Matches authored outcome O{index + 1}."}
                        for index, label in enumerate(labels)]}


class FakeVertex:
    configured = True

    def __init__(self, responses=None):
        self.responses = list(responses or [])
        self.json_prompts, self.text_prompts = [], []
        self.gate = asyncio.Event()
        self.gate.set()

    async def json(self, prompt, timeout):
        self.json_prompts.append(prompt)
        await self.gate.wait()
        value = self.responses.pop(0) if self.responses else drafted(f"Draft{len(self.json_prompts)}")
        if isinstance(value, Exception):
            raise value
        return value

    async def text(self, prompt, timeout, max_output_tokens=600):
        self.text_prompts.append(prompt)
        return 'Vertex advisory reply.'


class AiOptionTests(unittest.IsolatedAsyncioTestCase):
    client, view, reach, advance, action = (fixture.GameplayTests.client, fixture.GameplayTests.view,
        fixture.GameplayTests.reach, fixture.GameplayTests.advance, fixture.GameplayTests.action)

    async def asyncSetUp(self):
        await fixture.GameplayTests.asyncSetUp(self)
        self.use(FakeVertex())

    def use(self, vertex):
        self.vertex = vertex
        self.app = create_app(rooms=self.rooms, vertex_provider=vertex)
        self.ai = self.app.state.ai_options

    async def ready(self, ballot_source=None, code='AIOPT1'):
        for number in range(3):
            client = await self.client()
            self.clients.append(client)
            response = await client.post('/api/rooms' if number == 0 else '/api/rooms/join',
                                         json=fixture.command(room_code=code, display_name=f'Player {number}'))
            self.assertIn(response.status_code, (200, 201), response.text)
            view = response.json()
            self.ids.append(view['self_member_id'])
        self.path = '/api/rooms/' + view['room_id']
        self.room_id = self.rooms.codes[code]
        body = fixture.command(room_code=code, scenario_id='maplecart_cybersecurity', scenario_version=3,
                               timing_profile='standard_18', players=[
                                   {'member_id': member, 'role_id': 'ceo' if index == 1 else 'security'}
                                   for index, member in enumerate(self.ids)])
        if ballot_source is not None:
            body['ballot_source'] = ballot_source
        response = await self.clients[0].post(self.path + '/start', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def drain(self):
        await self.ai.tick()
        await asyncio.gather(*self.ai.tasks.values())
        return await self.view()

    def state(self):
        return self.rooms.rooms[self.room_id].phase.state

    async def test_options_generated_refreshed_and_frozen_instead_of_prepared(self):
        start = await self.ready()
        self.assertEqual(start['game']['ballot_source'], 'ai')
        speaking = await self.reach('speaking')
        self.assertEqual(speaking['game']['ai_options_status'], 'pending')
        self.assertEqual(speaking['game']['options_source'], 'prepared_fallback')
        first = await self.drain()
        self.assertEqual(first['game']['ai_options_status'], 'ready')
        self.assertEqual(first['game']['options_source'], 'ai')
        options = first['game']['current_node']['options']
        self.assertEqual([item['kind'] for item in options], ['ai'] * 3)
        self.assertTrue(all(item['description'] and item['rationale'] for item in options))
        self.assertTrue(all('outcome_id' not in item for item in options))
        await self.clients[0].post(self.path + '/contributions', json=fixture.command(
            phase_id=first['game']['phase_id'], kind='answer', source='typed', text='MARKER: preserve the finance logs first.'))
        discussion = await self.reach('discussion')
        refreshed = await self.drain()
        self.assertEqual(len(self.vertex.json_prompts), 2)
        self.assertIn('MARKER: preserve the finance logs first.', self.vertex.json_prompts[1])
        prompt = self.vertex.json_prompts[1]
        for expected in ('allowed_outcomes', 'Attached incident report', 'Which facts are confirmed?',
                         'The investigation boundary narrows'):
            self.assertIn(expected, prompt)
        self.assertNotIn('controller', prompt.lower())
        new_options = refreshed['game']['current_node']['options']
        self.assertTrue(all(item['label'].startswith('Draft2') for item in new_options))
        await self.drain()
        self.assertEqual(len(self.vertex.json_prompts), 2, 'one refresh per round only')
        proposal = await self.action(0, discussion, 'proposal', text='Hire an outside forensic firm today.')
        custom = proposal['game']['proposals'][0]['option_id']
        voting = await self.reach('voting')
        frozen = voting['game']['current_node']['options']
        self.assertEqual([item['kind'] for item in frozen], ['ai', 'ai', 'ai', 'custom'])
        self.assertEqual(frozen[3]['option_id'], custom)
        self.assertEqual(voting['game']['options_source'], 'ai')
        self.assertFalse({'contain_targeted', 'contain_wait', 'contain_broad'} & {item['option_id'] for item in frozen})
        chosen = frozen[1]
        for player in range(3):
            await self.action(player, voting, 'vote', option_id=chosen['option_id'])
        result = await self.advance(60)
        self.assertEqual(result['phase'], 'result')
        record = result['game']['last_result']
        self.assertEqual(record['resolution_kind'], 'ai')
        self.assertEqual(record['outcome_id'], 'delayed_containment')
        self.assertEqual(record['selected_option_id'], chosen['option_id'])
        self.assertEqual(record['selected_option_label'], chosen['label'])
        self.assertEqual(record['selection_method'], 'vote')
        self.assertEqual(record['vote_counts'][chosen['option_id']], 3)
        self.assertIsNotNone(record['ai_job_id'])
        reading = await self.advance(30)
        self.assertEqual(reading['phase'], 'reading')
        self.assertEqual(reading['game']['ai_options_status'], 'pending')
        self.assertEqual(reading['game']['current_node']['options'][0]['kind'], 'prepared')

    async def test_fallback_when_not_ready_and_late_result_is_discarded(self):
        await self.ready()
        await self.reach('speaking')
        self.vertex.gate.clear()
        await self.ai.tick()
        voting = await self.reach('voting')
        self.assertEqual(voting['game']['options_source'], 'prepared_fallback')
        self.assertEqual(voting['game']['ai_options_status'], 'failed')
        self.assertEqual([item['option_id'] for item in voting['game']['current_node']['options']],
                         ['contain_targeted', 'contain_wait', 'contain_broad'])
        self.vertex.gate.set()
        await asyncio.gather(*self.ai.tasks.values())
        after = await self.view()
        self.assertEqual(after['game']['current_node']['options'], voting['game']['current_node']['options'])
        self.assertEqual(self.state().ai_options.options, ())
        await self.action(0, voting, 'vote', option_id='contain_targeted')
        result = await self.advance(60)
        self.assertEqual(result['game']['last_result']['resolution_kind'], 'prepared')

    async def test_invalid_output_retries_once_then_falls_back(self):
        self.use(FakeVertex([{'options': []}, ValueError('bad json')]))
        await self.ready()
        await self.reach('speaking')
        failed = await self.drain()
        self.assertEqual(len(self.vertex.json_prompts), 2)
        self.assertEqual(failed['game']['ai_options_status'], 'failed')
        self.assertEqual(failed['game']['options_source'], 'prepared_fallback')
        self.assertEqual(failed['game']['current_node']['options'][0]['kind'], 'prepared')

    async def test_invalid_then_valid_retry_is_used(self):
        self.use(FakeVertex([drafted('Bad', ['Same label for all', 'Same label for all', 'same LABEL for all!']),
                             drafted('Good')]))
        await self.ready()
        await self.reach('speaking')
        ready = await self.drain()
        self.assertEqual(ready['game']['ai_options_status'], 'ready')
        self.assertTrue(all(item['label'].startswith('Good') for item in ready['game']['current_node']['options']))

    async def test_stale_round_job_is_discarded(self):
        await self.ready()
        await self.reach('speaking')
        self.vertex.gate.clear()
        await self.ai.tick()
        old = self.state().ai_options
        voting = await self.reach('voting')
        for player in range(3):
            await self.action(player, voting, 'vote', option_id='contain_targeted')
        await self.advance(60)
        await self.advance(30)
        self.assertEqual(self.state().round_number, 2)
        self.vertex.gate.set()
        await asyncio.gather(*self.ai.tasks.values())
        self.assertIsNone(self.state().ai_options)
        options = validate(drafted('Late'), OUTCOMES)
        self.assertFalse(await self.ai.complete(self.room_id, old.round_id, old.job_id, 'speaking', options))
        await self.reach('speaking')
        await self.drain()
        current = self.state().ai_options
        self.assertEqual(current.round_id, self.state().round_id)
        self.assertFalse(await self.ai.complete(self.room_id, current.round_id, old.job_id, 'discussion', options))
        self.assertNotEqual(self.state().ai_options.options, options)

    async def test_ceo_breaks_tie_between_ai_options(self):
        await self.ready()
        await self.reach('speaking')
        await self.drain()
        voting = await self.reach('voting')
        first, second, _ = voting['game']['current_node']['options']
        await self.action(0, voting, 'vote', option_id=first['option_id'])
        await self.action(1, voting, 'vote', option_id=second['option_id'])
        tied = await self.advance(60)
        self.assertEqual(tied['phase'], 'tie_break')
        self.assertEqual(sorted(tied['game']['tied_option_ids']), sorted([first['option_id'], second['option_id']]))
        result = await self.action(1, tied, 'tie-decision', option_id=second['option_id'])
        self.assertEqual(result['phase'], 'result')
        record = result['game']['last_result']
        self.assertEqual((record['selection_method'], record['resolution_kind'], record['outcome_id']),
                         ('ceo', 'ai', 'delayed_containment'))

    async def test_authored_ballot_source_skips_generation(self):
        start = await self.ready('authored')
        self.assertEqual(start['game']['ballot_source'], 'authored')
        speaking = await self.reach('speaking')
        self.assertEqual(speaking['game']['ai_options_status'], 'disabled')
        self.assertEqual(speaking['game']['options_source'], 'authored')
        await self.drain()
        await self.reach('discussion')
        await self.drain()
        self.assertEqual(self.vertex.json_prompts, [])
        voting = await self.reach('voting')
        self.assertEqual(voting['game']['options_source'], 'authored')
        self.assertEqual([item['kind'] for item in voting['game']['current_node']['options']], ['prepared'] * 3)

    async def test_disabled_without_configured_provider(self):
        vertex = FakeVertex()
        vertex.configured = False
        self.use(vertex)
        await self.ready()
        speaking = await self.reach('speaking')
        await self.drain()
        self.assertEqual(speaking['game']['ai_options_status'], 'disabled')
        self.assertEqual(self.vertex.json_prompts, [])

    async def test_invalid_ballot_source_is_rejected(self):
        client = await self.client()
        created = (await client.post('/api/rooms', json=fixture.command(room_code='BADSRC', display_name='Host'))).json()
        response = await client.post(f"/api/rooms/{created['room_id']}/start", json=fixture.command(
            room_code='BADSRC', scenario_id='maplecart_cybersecurity', scenario_version=3, timing_profile='standard_18',
            players=[{'member_id': created['self_member_id'], 'role_id': 'ceo'}], ballot_source='model'))
        self.assertEqual(response.status_code, 422)

    async def test_facilitation_uses_vertex_when_configured(self):
        class Hosted:
            configured = True
            prompts = []
            async def run(self, prompt, request_id, timeout):
                self.prompts.append(prompt)
                return 'Hosted reply.'
        hosted = Hosted()
        self.app = create_app(rooms=self.rooms, vertex_provider=self.vertex, inference_provider=hosted)
        await self.ready()
        for _ in range(100):
            body = (await self.clients[0].get(self.path + '/facilitation')).json()
            if body['opening']['status'] != 'pending':
                break
            await asyncio.sleep(0.01)
        self.assertEqual(body['opening']['source'], 'vertex')
        self.assertEqual(body['opening']['text'], 'Vertex advisory reply.')
        self.assertEqual(len(self.vertex.text_prompts), 1)
        self.assertEqual(hosted.prompts, [])


class ValidationTests(unittest.TestCase):
    def test_strict_validation(self):
        options = validate(drafted('Valid'), OUTCOMES)
        self.assertEqual([item.outcome_id for item in options], list(OUTCOMES.values()))
        self.assertTrue(all(item.kind == 'ai' and item.option_id.startswith('ai_') for item in options))
        self.assertEqual(len({item.option_id for item in options}), 3)
        by_id = drafted('Ids')
        by_id['options'][0]['outcome'] = 'broad_shutdown'
        self.assertEqual(validate(by_id, OUTCOMES)[0].outcome_id, 'broad_shutdown')
        four = drafted('Four', [f'Four option {i}: distinct action' for i in range(4)])
        four['options'][3]['outcome'] = 'O1'
        self.assertEqual(len(validate(four, OUTCOMES)), 3)
        bad_cases = []
        unknown = drafted('Unknown'); unknown['options'][0]['outcome'] = 'containment_no_decision'; bad_cases.append(unknown)
        short = drafted('Short'); short['options'][0]['label'] = 'Go'; bad_cases.append(short)
        long = drafted('Long'); long['options'][0]['description'] = 'x' * 500; bad_cases.append(long)
        missing = drafted('Missing'); del missing['options'][0]['rationale']; bad_cases.append(missing)
        two = drafted('Two'); two['options'] = two['options'][:2]; bad_cases.append(two)
        bad_cases.append(drafted('Dup', ['Duplicate label here', 'duplicate label HERE', 'Another distinct option']))
        bad_cases.append({'choices': []})
        for case in bad_cases:
            with self.assertRaises(InvalidOptions):
                validate(case, OUTCOMES)


class FakeResponse(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *args): self.close()


class FakeOpener:
    def __init__(self, payload): self.payload, self.requests = payload, []
    def open(self, request, timeout):
        self.requests.append(request)
        return FakeResponse(json.dumps(self.payload).encode())


class VertexTextTests(unittest.IsolatedAsyncioTestCase):
    def test_env_configuration(self):
        with unittest.mock.patch.dict(os.environ, {'GOOGLE_API_KEY': '', 'VERTEX_API_KEY': ''}):
            os.environ.pop('BOARDROOM_VERTEX_ENABLED', None)
            self.assertFalse(VertexText.from_env().configured)
        with unittest.mock.patch.dict(os.environ, {'GOOGLE_API_KEY': 'test-key', 'BOARDROOM_VERTEX_ENABLED': ''}):
            self.assertTrue(VertexText.from_env().configured)
        with unittest.mock.patch.dict(os.environ, {'GOOGLE_API_KEY': 'test-key', 'BOARDROOM_VERTEX_ENABLED': 'false'}):
            self.assertFalse(VertexText.from_env().configured)
        os.environ['BOARDROOM_VERTEX_ENABLED'] = 'false'

    def test_parse_json_object(self):
        self.assertEqual(parse_json_object('```json\n{"a": 1}\n```'), {'a': 1})
        for bad in ('no json', '[1]', 'Sure: {"a": 1}', '{"a": 1} trailing'):
            with self.assertRaises(ValueError):
                parse_json_object(bad)

    async def test_generate_records_usage_with_unlimited_ledger(self):
        payload = {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [
            {'text': 'hidden', 'thought': True}, {'text': '{"options": []}'}]}}],
            'usageMetadata': {'promptTokenCount': 10, 'candidatesTokenCount': 5, 'totalTokenCount': 15}}
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / 'vertex' / 'ledger.sqlite'
            opener = FakeOpener(payload)
            vertex = VertexText('test-key', ledger=ledger, unlimited=True, opener=opener)
            self.assertFalse(ledger.exists(), 'construction never touches disk')
            self.assertEqual(await vertex.json('prompt', 5), {'options': []})
            status = vertex.budget().status()
            self.assertTrue(status['unlimited'])
            self.assertEqual(status['attempts'], 1)
            body = json.loads(opener.requests[0].data)
            self.assertEqual(body['generationConfig']['responseMimeType'], 'application/json')
            self.assertEqual(body['generationConfig']['thinkingConfig']['thinkingLevel'], 'LOW')
            failing = VertexText('test-key', ledger=ledger, opener=FakeOpener({'candidates': [{'finishReason': 'MAX_TOKENS'}]}))
            with self.assertRaises(Exception) as caught:
                await failing.text('prompt', 5)
            self.assertNotIn('test-key', str(caught.exception))
            self.assertEqual(failing.budget().status()['attempts'], 2)



if __name__ == '__main__':
    unittest.main()
