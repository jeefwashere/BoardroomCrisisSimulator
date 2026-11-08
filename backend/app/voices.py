"""ElevenLabs voices for every speaker in the boardroom.

Each agent and each player role speaks with its own premade ElevenLabs voice (premade voices are
available to every account). Chosen from the account's voice list through the ElevenLabs MCP on
Nov 8 2026. Override any entry with BOARDROOM_TTS_VOICES, a JSON object of key to voice ID; keys
that are missing fall back to BOARDROOM_TTS_VOICE_ID.
"""

import json
import os

DEFAULT_VOICES = {
    # Agents
    "facilitator": "JBFqnCBsd6RMkjVDRZzb",    # George: warm British storyteller, opens the briefing
    "security": "SAz9YHcvj6GT2YYXdXww",       # River: calm, neutral; IT and security expert
    "it": "SAz9YHcvj6GT2YYXdXww",             # River: the IT adviser shares the technical voice
    "operations": "XrExE9yKIg1WjnnlVkGX",     # Matilda: knowledgeable, professional
    "governance": "Xb7hH8MSUJpSbSDYk0k2",     # Alice: clear British educator
    "journalist": "FGY2WhTYpPnrIDTdsKH5",     # Laura: lively outside pressure
    "coach": "EXAVITQu4vr4xnSDxMaL",          # Sarah: reassuring, confident private coach
    # Players (AI generated replies speak in the player's role voice)
    "ceo": "CwhRBWXzGAHq8TQ4Fs17",            # Roger: resonant, middle aged (Alex)
    "technology": "bIHbv24MWmeRgasZH58o",     # Will: relaxed, young (Morgan)
    "communications": "hpp4J3VqNfWAUOO0d1Us", # Bella: bright, professional (Sam)
}


def valid(voice: object) -> bool:
    return isinstance(voice, str) and 0 < len(voice) <= 64 and all(c.isalnum() or c in "_-" for c in voice)


def voice_map() -> dict[str, str]:
    voices = dict(DEFAULT_VOICES)
    raw = os.environ.get("BOARDROOM_TTS_VOICES", "").strip()
    if raw:
        try:
            override = json.loads(raw)
        except ValueError:
            override = {}
        if isinstance(override, dict):
            voices.update({str(key): value for key, value in override.items() if valid(value)})
    return voices
