"""Narration contracts exercised with local bytes and mocked provider adapters."""

import asyncio
from dataclasses import FrozenInstanceError
import os
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from threading import Event, get_ident
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from backend.app.narration import MAX_AUDIO_BYTES, MediaResult, NarrationService


class NarrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.room, self.narration, self.member = uuid4(), uuid4(), uuid4()

    async def test_default_disabled_without_environment_or_provider_access(self):
        with patch.dict(os.environ, {}, clear=True), patch("rehearsal.voice.VoiceBudget") as budget:
            service = NarrationService.from_env()
            self.assertEqual(await service.prepare(self.room, self.narration, "Caption"),
                             MediaResult("disabled", "Caption"))
            budget.assert_not_called()
        with self.assertRaises(KeyError):
            service.audio(self.room, self.narration)

    async def test_shared_generation_is_off_loop_and_cached(self):
        loop_thread = get_ident()
        calls = []

        def synthesize(text):
            calls.append((text, get_ident()))
            return b"audio"

        service = NarrationService(synthesize)
        self.assertEqual(service.status(self.room, self.narration, "  Exact text  ").status, "pending")
        results = await asyncio.gather(*(
            service.prepare(self.room, self.narration, "  Exact text  ") for _ in range(20)
        ))
        self.assertTrue(all(result == MediaResult("ready", "  Exact text  ") for result in results))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "  Exact text  ")
        self.assertNotEqual(calls[0][1], loop_thread)
        self.assertEqual(service.audio(self.room, self.narration), b"audio")
        await service.prepare(self.room, self.narration, "  Exact text  ")
        self.assertEqual(len(calls), 1)
        with self.assertRaises(FrozenInstanceError):
            results[0].status = "failed"

    async def test_cancelled_caller_does_not_cancel_shared_generation(self):
        started, release = Event(), Event()
        calls = []

        def synthesize(text):
            calls.append(text)
            started.set()
            if not release.wait(2):
                raise RuntimeError("Test synthesis was not released")
            return b"audio"

        service = NarrationService(synthesize)
        caller = asyncio.create_task(service.prepare(self.room, self.narration, "Caption"))
        try:
            self.assertTrue(await asyncio.to_thread(started.wait, 1))
            caller.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await caller
            self.assertEqual(service.status(self.room, self.narration, "Caption").status, "pending")
        finally:
            release.set()
        self.assertEqual((await service.prepare(self.room, self.narration, "Caption")).status, "ready")
        self.assertEqual(calls, ["Caption"])

    async def test_exception_is_redacted_and_never_retried(self):
        synthesize = Mock(side_effect=RuntimeError("secret-key /private/cache/provider.json"))
        service = NarrationService(synthesize)
        result = await service.prepare(self.room, self.narration, "Caption")
        self.assertEqual(result, MediaResult("failed", "Caption", "Narration unavailable"))
        self.assertEqual(await service.prepare(self.room, self.narration, "Caption"), result)
        synthesize.assert_called_once_with("Caption")
        with self.assertRaises(KeyError):
            service.audio(self.room, self.narration)

    async def test_identity_rejects_changed_text_and_is_scoped_to_room(self):
        synthesize = Mock(return_value=b"audio")
        service = NarrationService(synthesize)
        await service.prepare(self.room, self.narration, "First")
        with self.assertRaises(ValueError):
            service.status(self.room, self.narration, "Changed")
        with self.assertRaises(ValueError):
            await service.prepare(self.room, self.narration, "Changed")
        await service.prepare(uuid4(), self.narration, "Changed")
        self.assertEqual(synthesize.call_count, 2)

    async def test_text_bounds_preserve_exact_500_characters(self):
        synthesize = Mock(return_value=b"audio")
        service = NarrationService(synthesize)
        for text in ("", "   ", "x" * 501, None):
            with self.subTest(text_length=len(text) if text else 0), self.assertRaises(ValueError):
                await service.prepare(self.room, uuid4(), text)
        text = "x" * 500
        self.assertEqual((await service.prepare(self.room, self.narration, text)).text, text)
        synthesize.assert_called_once_with(text)

    async def test_audio_size_and_type_bounds(self):
        for content in (b"", "wrong type", b"x" * (MAX_AUDIO_BYTES + 1)):
            with self.subTest(kind=type(content)):
                service = NarrationService(lambda text: content)
                self.assertEqual((await service.prepare(self.room, self.narration, "Caption")).status, "failed")
                with self.assertRaises(KeyError):
                    service.audio(self.room, self.narration)

    async def test_delivery_requires_audio_and_actual_start_before_completion(self):
        service = NarrationService(lambda text: b"audio")
        with self.assertRaises(KeyError):
            service.record_delivery(self.room, self.narration, self.member, "started")
        await service.prepare(self.room, self.narration, "Caption")
        self.assertEqual(service.deliveries(self.room, self.narration), ())
        with self.assertRaises(ValueError):
            service.record_delivery(self.room, self.narration, self.member, "completed")
        for event in ("started", "started", "completed", "completed"):
            service.record_delivery(self.room, self.narration, self.member, event)
        events = service.deliveries(self.room, self.narration)
        self.assertIsInstance(events, tuple)
        self.assertEqual([event.event for event in events], ["started", "completed"])
        with self.assertRaises(FrozenInstanceError):
            events[0].event = "failed"
        with self.assertRaises(ValueError):
            service.record_delivery(self.room, self.narration, self.member, "failed")
        with self.assertRaises(ValueError):
            service.record_delivery(self.room, self.narration, uuid4(), "unknown")
        service.record_delivery(self.room, self.narration, uuid4(), "failed")


class NarrationEnvironmentTests(unittest.IsolatedAsyncioTestCase):
    def config(self, directory):
        return {
            "BOARDROOM_TTS_ENABLED": "true",
            "BOARDROOM_VOICE_BUDGET_USD": "0.50",
            "BOARDROOM_TTS_USD_PER_1K": "0.01",
            "BOARDROOM_TTS_VOICE_ID": "selected_voice",
            "BOARDROOM_TTS_LEDGER": str(Path(directory) / "shared.sqlite"),
            "BOARDROOM_TTS_CACHE": str(Path(directory) / "cache"),
            "ELEVENLABS_API_KEY": "mock-key",
        }

    async def test_every_explicit_guard_precedes_key_read_and_ledger_creation(self):
        with TemporaryDirectory() as directory:
            complete = self.config(directory)
            variants = [{key: value for key, value in complete.items() if key != missing}
                        for missing in complete if missing not in ("ELEVENLABS_API_KEY", "BOARDROOM_TTS_CACHE", "BOARDROOM_TTS_VOICE_ID")]
            variants += [dict(complete, **changes) for changes in (
                {"BOARDROOM_TTS_ENABLED": "TRUE"},
                {"BOARDROOM_VOICE_BUDGET_USD": "0"},
                {"BOARDROOM_VOICE_BUDGET_USD": "nan"},
                {"BOARDROOM_TTS_USD_PER_1K": "inf"},
                {"BOARDROOM_TTS_USD_PER_1K": "unverified"},
                {"BOARDROOM_TTS_VOICE_ID": "bad/voice"},
                {"BOARDROOM_TTS_LEDGER": " "},
            )]
            for config in variants:
                with self.subTest(config=config):
                    reads = []

                    def get(name, default=None):
                        reads.append(name)
                        return config.get(name, default)

                    with patch("backend.app.narration.os.environ.get", side_effect=get), \
                            patch("rehearsal.voice.VoiceBudget") as budget:
                        service = NarrationService.from_env()
                    self.assertNotIn("ELEVENLABS_API_KEY", reads)
                    budget.assert_not_called()
                    self.assertEqual((await service.prepare(uuid4(), uuid4(), "Caption")).status, "disabled")
            self.assertEqual(list(Path(directory).iterdir()), [])

    async def test_missing_key_does_not_initialize_ledger(self):
        with TemporaryDirectory() as directory:
            config = self.config(directory)
            config.pop("ELEVENLABS_API_KEY")
            with patch.dict(os.environ, config, clear=True), patch("rehearsal.voice.VoiceBudget") as budget:
                service = NarrationService.from_env()
            budget.assert_not_called()
            self.assertEqual((await service.prepare(uuid4(), uuid4(), "Caption")).status, "disabled")
            self.assertEqual(list(Path(directory).iterdir()), [])

    async def test_opening_uses_existing_facilitator_voice_without_a_general_voice_id(self):
        from backend.app.voices import DEFAULT_VOICES
        for value in (None, ""):
            with self.subTest(value=value), TemporaryDirectory() as directory:
                config = self.config(directory)
                if value is None:
                    config.pop("BOARDROOM_TTS_VOICE_ID")
                else:
                    config["BOARDROOM_TTS_VOICE_ID"] = value
                audio = Path(directory) / "fixture.mp3"
                audio.write_bytes(b"fixture-audio")
                with patch.dict(os.environ, config, clear=True), \
                        patch("rehearsal.voice.VoiceBudget"), \
                        patch("rehearsal.voice.ElevenSpeech") as speech:
                    speech.return_value.speak.return_value = {"path": str(audio), "cached": True}
                    service = NarrationService.from_env()
                    result = await service.prepare(uuid4(), uuid4(), "Opening briefing")
                self.assertEqual(result.status, "ready")
                speech.return_value.speak.assert_called_once_with(
                    "Opening briefing", DEFAULT_VOICES["facilitator"],
                    model_id="eleven_flash_v2_5", output_format="mp3_44100_64")

    async def test_selected_real_adapter_wiring_uses_mocks_only(self):
        with TemporaryDirectory() as directory:
            config = self.config(directory)
            audio = Path(directory) / "fixture.mp3"
            audio.write_bytes(b"fixture-audio")
            with patch.dict(os.environ, config, clear=True), \
                    patch("rehearsal.voice.VoiceBudget") as budget, \
                    patch("rehearsal.voice.ElevenSpeech") as speech:
                speech.return_value.speak.return_value = {"path": str(audio), "cached": True}
                service = NarrationService.from_env()
                room, narration = uuid4(), uuid4()
                self.assertEqual((await service.prepare(room, narration, "Exact caption")).status, "ready")
                self.assertEqual(service.audio(room, narration), b"fixture-audio")
                await service.prepare(room, narration, "Exact caption")
            budget.assert_called_once_with(Path(config["BOARDROOM_TTS_LEDGER"]), 0.5)
            speech.assert_called_once_with("mock-key", budget.return_value,
                                           config["BOARDROOM_TTS_CACHE"], tts_per_1k=0.01)
            speech.return_value.speak.assert_called_once_with(
                "Exact caption", "selected_voice", model_id="eleven_flash_v2_5", output_format="mp3_44100_64")

    async def test_local_adapter_initialization_failure_disables_media_without_leaking_errors(self):
        with TemporaryDirectory() as directory:
            config = self.config(directory)
            for component in ("VoiceBudget", "ElevenSpeech"):
                for error in (OSError, ValueError, sqlite3.OperationalError):
                    with self.subTest(component=component, error=error), \
                            patch.dict(os.environ, config, clear=True), \
                            patch("rehearsal.voice.VoiceBudget") as budget, \
                            patch("rehearsal.voice.ElevenSpeech") as speech:
                        target = budget if component == "VoiceBudget" else speech
                        target.side_effect = error("mock-key /private/cache")
                        service = NarrationService.from_env()
                    result = await service.prepare(uuid4(), uuid4(), "Caption remains available")
                    self.assertEqual(result, MediaResult("disabled", "Caption remains available"))
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
