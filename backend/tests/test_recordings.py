"""Actual original audio storage and provider fixture transcription boundaries."""

import asyncio
import base64
import io
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4
import wave

from backend.app.main import create_app
from backend.app.recordings import Recordings
from backend.tests import test_gameplay as fixture
command = fixture.command


def wav(seconds=1):
    out = io.BytesIO()
    with wave.open(out, 'wb') as value:
        value.setnchannels(1)
        value.setsampwidth(2)
        value.setframerate(8000)
        value.writeframes(b'\0\0' * int(8000 * seconds))
    return out.getvalue()


class RecordingsTests(unittest.IsolatedAsyncioTestCase):
    client, ready, view, reach, advance, action = (fixture.GameplayTests.client, fixture.GameplayTests.ready,
        fixture.GameplayTests.view, fixture.GameplayTests.reach, fixture.GameplayTests.advance, fixture.GameplayTests.action)

    async def asyncSetUp(self):
        await fixture.GameplayTests.asyncSetUp(self)
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.calls = []
        def transcribe(raw, mime):
            self.calls.append((len(raw), mime))
            return 'We should preserve the evidence.'
        self.media = Recordings(self.rooms, self.root, transcribe)
        self.app = create_app(rooms=self.rooms, recordings_service=self.media)

    async def record(self):
        await self.ready()
        speaking = await self.reach('speaking')
        body = command(phase_id=speaking['game']['phase_id'], round_id=speaking['game']['round_id'])
        response = await self.clients[0].post(self.path + '/recordings/begin', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json(), body

    async def send(self, item, raw=None, index=0):
        self.clock.now += 1
        return await self.clients[index].post(self.path + '/recordings/' + item['recording_id'],
            json={'audio_base64': base64.b64encode(wav() if raw is None else raw).decode(), 'mime_type': 'audio/wav'})

    async def wait_ready(self, item):
        for _ in range(100):
            result = (await self.clients[0].get(self.path + '/extras')).json()['recordings'][0]
            if result['status'] not in ('validating_audio', 'transcribing'):
                return result
            await asyncio.sleep(.02)
        self.fail('Transcription fixture did not finish')

    async def test_original_audio_review_provenance_and_exact_retry(self):
        item, body = await self.record()
        repeated = await self.clients[0].post(self.path + '/recordings/begin', json=body)
        self.assertEqual(repeated.json(), item)
        self.assertEqual((await self.send(item)).status_code, 200)
        ready = await self.wait_ready(item)
        self.assertEqual(ready['status'], 'review_required')
        self.assertEqual(ready['member_id'], self.ids[0])
        self.assertEqual(ready['phase_id'], body['phase_id'])
        self.assertAlmostEqual(ready['duration_seconds'], 1, places=1)
        audio = await self.clients[1].get(self.path + '/recordings/' + item['recording_id'] + '/audio')
        self.assertEqual(audio.content, wav())
        reviewed = await self.clients[0].post(self.path + '/recordings/' + item['recording_id'] + '/review', json={'text': ready['transcript']})
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        self.assertEqual(reviewed.json()['status'], 'reviewed')
        self.assertEqual((await self.send(item)).status_code, 200)
        self.assertEqual(len(self.calls), 1)
        changed = await self.send(item, wav(2))
        self.assertEqual(changed.status_code, 409)
        changed = await self.clients[0].post(self.path + '/recordings/' + item['recording_id'] + '/review', json={'text': 'changed'})
        self.assertEqual(changed.status_code, 409)
        self.assertEqual((self.root / (item['recording_id'] + '.audio')).stat().st_mode & 0o777, 0o600)
        self.assertTrue((self.root / (item['recording_id'] + '.json')).exists())

    async def test_foreign_speaker_and_owner_cannot_supply_audio_or_transcripts(self):
        item, body = await self.record()
        wrong = await self.clients[1].post(self.path + '/recordings/begin', json={**body, 'command_id': str(uuid4())})
        self.assertEqual(wrong.status_code, 403)
        self.assertEqual((await self.send(item, index=1)).status_code, 403)
        other = await self.client()
        self.assertEqual((await other.get(self.path + '/recordings/' + item['recording_id'] + '/audio')).status_code, 403)
        self.assertEqual((await self.clients[1].post(self.path + '/recordings/' + item['recording_id'] + '/review', json={'text': 'spoofed'})).status_code, 403)
        corrupt = await self.send(item, b'not real audio' * 5)
        self.assertEqual(corrupt.status_code, 422)
        self.assertFalse(self.calls)

    async def test_paid_transcription_disabled_retains_audio_without_calls(self):
        self.media.transcriber = None
        item, _ = await self.record()
        self.assertEqual((await self.send(item)).status_code, 200)
        ready = await self.wait_ready(item)
        self.assertEqual(ready['status'], 'transcription_disabled')
        self.assertTrue(ready['audio_available'])
        self.assertFalse(self.calls)

    async def test_actual_duration_validation_rejects_oversized_turn_before_provider(self):
        item, _ = await self.record()
        self.assertEqual((await self.send(item, wav(31))).status_code, 200)
        ready = await self.wait_ready(item)
        self.assertEqual(ready['status'], 'audio_validation_failed')
        self.assertFalse(self.calls)

    async def test_upload_grace_and_expiry_preserve_turn_identity(self):
        item, _ = await self.record()
        await self.advance(30)
        saved = await self.send(item)
        self.assertEqual(saved.status_code, 200, saved.text)
        await self.wait_ready(item)
        self.assertEqual(len(self.calls), 1)
        # A retained file can be read after the meeting ends.
        current = await self.view()
        await self.clients[0].post(self.path + '/end', json=command(phase_id=current['game']['phase_id']))
        self.assertEqual((await self.clients[0].get(self.path + '/recordings/' + item['recording_id'] + '/audio')).content, wav())

    async def test_new_begin_command_recovers_existing_unuploaded_grant(self):
        item, body = await self.record()
        response = await self.clients[0].post(self.path + '/recordings/begin', json={**body, 'command_id': str(uuid4())})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['recording_id'], item['recording_id'])
        self.assertEqual(len(self.media.entries), 1)

    async def test_recording_cannot_exceed_short_remaining_turn(self):
        await self.ready(30)
        await self.reach('speaking')
        await self.advance(4)
        speaking = await self.view()
        response = await self.clients[0].post(self.path + '/recordings/begin', json=command(
            phase_id=speaking['game']['phase_id'], round_id=speaking['game']['round_id']))
        self.assertEqual(response.status_code, 200, response.text)
        item = response.json()
        self.assertEqual((await self.send(item, wav(3))).status_code, 200)
        ready = await self.wait_ready(item)
        self.assertEqual(ready['status'], 'audio_validation_failed')
        self.assertFalse(self.calls)

    async def test_reviewed_recordings_are_in_the_final_evidence_export(self):
        item, _ = await self.record()
        await self.send(item)
        ready = await self.wait_ready(item)
        review = await self.clients[0].post(self.path + '/recordings/' + item['recording_id'] + '/review', json={'text': ready['transcript']})
        self.assertEqual(review.status_code, 200)
        current = await self.view()
        await self.clients[0].post(self.path + '/end', json=command(phase_id=current['game']['phase_id']))
        evidence = await self.clients[0].get(self.path + '/evaluation-evidence')
        self.assertEqual(evidence.status_code, 200, evidence.text)
        records = evidence.json()['recordings']
        self.assertEqual(records[0]['recording_id'], item['recording_id'])
        self.assertEqual(records[0]['reviewed_text'], ready['transcript'])
        self.assertTrue(records[0]['audio_available'])

    async def test_host_skip_prevents_paid_transcription_of_audio_after_actual_turn(self):
        item, _ = await self.record()
        self.clock.now += 1
        current = await self.view()
        await self.action(0, current, 'speaker/skip', reason='Turn stopped')
        self.assertEqual((await self.send(item, wav(10))).status_code, 200)
        result = await self.wait_ready(item)
        self.assertEqual(result['status'], 'audio_validation_failed')
        self.assertFalse(self.calls)

    async def test_shutdown_retains_original_and_interrupts_processing_without_retry(self):
        import time
        self.media._duration = lambda path: (time.sleep(.2), 1)[1]
        item, _ = await self.record()
        await self.send(item)
        saved = next(iter(self.media.entries.values()))
        task = saved.task
        await self.media.close()
        self.assertTrue(task.cancelled())
        self.assertEqual(saved.status, 'processing_interrupted')
        self.assertTrue((self.root / (item['recording_id'] + '.audio')).exists())
        self.assertFalse(self.calls)


if __name__ == '__main__':
    unittest.main()
