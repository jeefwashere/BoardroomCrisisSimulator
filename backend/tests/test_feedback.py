"""Every retained evidence character is considered; model prose never changes history."""

import asyncio
import json
from pathlib import Path
import re
import tempfile
import unittest

from backend.app.feedback import Feedback, parse_observations
from backend.app.recordings import Recordings
from backend.tests import test_gameplay as fixture


class Provider:
    configured = True
    def __init__(self): self.prompts = []
    async def run(self, prompt, request_id, timeout):
        self.prompts.append(prompt)
        rows = json.loads(prompt.split('\nEVIDENCE\n')[1])
        return '\n'.join(f"{row['id']}|{next(iter(row['rubric']))}|supported" for row in rows)



class FeedbackTests(unittest.IsolatedAsyncioTestCase):
    client, ready, view, reach, advance, action = (fixture.GameplayTests.client, fixture.GameplayTests.ready,
        fixture.GameplayTests.view, fixture.GameplayTests.reach, fixture.GameplayTests.advance, fixture.GameplayTests.action)

    async def asyncSetUp(self):
        await fixture.GameplayTests.asyncSetUp(self)
        self.provider = Provider()
        self.media = Recordings(self.rooms, Path(self.enterContext(tempfile.TemporaryDirectory())))
        self.feedback = Feedback(self.rooms, self.media, self.provider)

    async def ended(self, text='Preserve the logs.'):
        current = await self.ready()
        response = await self.clients[0].post(self.path + '/contributions', json=fixture.command(
            phase_id=current['game']['phase_id'], kind='chat', source='typed', text=text))
        self.assertEqual(response.status_code, 201)
        current = await self.view()
        await self.clients[0].post(self.path + '/end', json=fixture.command(phase_id=current['game']['phase_id']))
        return self.clients[0].headers['X-Boardroom-Session']

    async def wait(self):
        for _ in range(100):
            current = self.feedback.view(self.room_id)
            if current['status'] != 'running': return current
            await asyncio.sleep(.01)
        self.fail('Feedback did not finish')

    async def test_all_text_fragments_and_factual_ending_are_preserved(self):
        text = 'A' * 3990 + 'END_MARKER'
        session = await self.ended(text)
        history = (await self.view())['game']['history']
        await self.feedback.start(session, self.room_id)
        result = await self.wait()
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['completed_parts'], result['total_parts'])
        self.assertTrue(all(len(prompt) <= 4000 for prompt in self.provider.prompts))
        self.assertIn('END_MARKER', '\n'.join(self.provider.prompts))
        self.assertEqual((await self.view())['game']['history'], history)
        self.assertIn('host_ended', result['text'])

    async def test_unknown_evidence_rejected_and_provider_failure_keeps_history(self):
        session = await self.ended()
        async def fail(*args): raise RuntimeError('private provider content')
        self.provider.run = fail
        await self.feedback.start(session, self.room_id)
        result = await self.wait()
        self.assertEqual(result['status'], 'failed')
        self.assertIn('Committed decisions', result['text'])
        self.assertNotIn('private provider', result['error'])
        with self.assertRaises(ValueError):
            parse_observations('{"observations":[{"text":"invented","evidence_ids":["unknown"]}]}', {'known'})

    async def test_unconfigured_service_keeps_factual_report(self):
        session = await self.ended()
        self.provider.configured = False
        result = await self.feedback.start(session, self.room_id)
        self.assertEqual(result['status'], 'disabled')
        self.assertIn('host_ended', result['text'])

    async def test_pending_recording_blocks_final_evaluation_until_reviewed(self):
        from backend.app.recordings import Recording
        from backend.app.rooms import utc_now
        from uuid import UUID, uuid4
        session = await self.ended()
        item = Recording(uuid4(), self.room_id, UUID(self.ids[0]), uuid4(), 1, uuid4(),
                         self.clock.now, self.clock.now + 20, utc_now(), status='review_required',
                         transcript='Unreviewed text')
        self.media.entries[item.recording_id] = item
        waiting = await self.feedback.start(session, self.room_id)
        self.assertEqual(waiting['status'], 'waiting_media')
        self.assertFalse(self.provider.prompts)
        item.reviewed_text, item.status = 'Verified speech evidence', 'reviewed'
        await self.feedback.start(session, self.room_id)
        result = await self.wait()
        self.assertEqual(result['status'], 'ready')
        self.assertIn('Verified speech evidence', '\n'.join(self.provider.prompts))
        self.assertNotIn('Unreviewed text', '\n'.join(self.provider.prompts))

    async def test_shutdown_cancels_feedback_without_reopening_game(self):
        session = await self.ended()
        started = asyncio.Event()
        async def wait(*args):
            started.set()
            await asyncio.Event().wait()
        self.provider.run = wait
        await self.feedback.start(session, self.room_id)
        await started.wait()
        task = self.feedback.entries[self.room_id]['task']
        await self.feedback.close()
        self.assertTrue(task.cancelled())
        self.assertEqual(self.feedback.view(self.room_id)['status'], 'interrupted')
        self.assertEqual((await self.view())['phase'], 'ended')

    async def test_single_observation_schema_keeps_exact_citations_and_rejects_truncation(self):
        result = parse_observations('{"evidence_ids":["E1"],"text":"A supported observation."}', {'E1'})
        self.assertEqual(result[0]['evidence_ids'], ['E1'])
        with self.assertRaises(ValueError):
            parse_observations('{"observations":[{"evidence_ids":["E1"],"text":"truncated', {'E1'})

    async def test_assessment_cites_the_entire_classified_excerpt_not_an_unselected_prefix(self):
        text = 'The opening only describes timing. Later, preserve all available logs and name an incident owner.'
        session = await self.ended(text)
        await self.feedback.start(session, self.room_id)
        result = await self.wait()
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['evidence_refs'][0]['quote'], text)
        self.assertIn('Later, preserve', result['evidence_refs'][0]['quote'])

    async def test_result_chat_uses_released_facts_and_lobby_uses_initial_context(self):
        from uuid import UUID
        clients = [await self.client() for _ in range(3)]
        made = await clients[0].post('/api/rooms', json=fixture.command(room_code='CTX001', display_name='Host'))
        room = made.json(); self.path = '/api/rooms/' + room['room_id']; self.room_id = UUID(room['room_id'])
        ids = [room['self_member_id']]
        for index in (1,2):
            joined = await clients[index].post('/api/rooms/join', json=fixture.command(room_code='CTX001', display_name=f'Guest {index}'))
            ids.append(joined.json()['self_member_id'])
        self.clients, self.ids = clients, ids
        await clients[0].post(self.path + '/contributions', json=fixture.command(phase_id=None, kind='chat', source='typed', text='LOBBY_CONTEXT'))
        started = await clients[0].post(self.path + '/start', json=fixture.command(room_code='CTX001', scenario_id='maplecart_cybersecurity', scenario_version=3, timing_profile='standard_18', players=[{'member_id': value, 'role_id': 'ceo' if index==1 else 'security'} for index,value in enumerate(ids)]))
        self.assertEqual(started.status_code, 200, started.text)
        voting = await self.reach('voting')
        await self.action(0,voting,'vote',option_id='contain_targeted')
        result = await self.advance(60)
        await clients[0].post(self.path + '/contributions',json=fixture.command(phase_id=result['game']['phase_id'],kind='chat',source='typed',text='RESULT_CONTEXT:160 records exported'))
        await clients[0].post(self.path + '/end',json=fixture.command(phase_id=result['game']['phase_id']))
        await self.feedback.start(clients[0].headers['X-Boardroom-Session'],self.room_id)
        complete = await self.wait()
        self.assertEqual(complete['status'],'ready')
        rows = [row for prompt in self.provider.prompts for row in json.loads(prompt.split('\nEVIDENCE\n')[1])]
        lobby = next(row for row in rows if row['text']=='LOBBY_CONTEXT')
        after = next(row for row in rows if row['text'].startswith('RESULT_CONTEXT'))
        self.assertEqual(lobby['facts_known']['verified_export_records'],0)
        self.assertEqual(after['facts_known']['verified_export_records'],160)


if __name__ == '__main__': unittest.main()
