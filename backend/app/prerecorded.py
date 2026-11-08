"""Prerecorded fictional member answers for the start at Round 3 test shortcut (`start_at: "assessment"`).

Reads the saved clip catalog (`playtest/fixtures/recordings.json`): each seat's Round 1 individual decision
(`r1_member_{seat}_step_1`) and three Round 2 coaching answers (`r2_member_{seat}_step_{1..3}`). Seat 1, 2, 3 is
the electorate order. A seat is offered only when all four texts exist. Never calls a provider.
"""

import json
from pathlib import Path

from .facilitation import RECORDINGS_CATALOG

TEXT_LIMIT = 1200


def load_prerecorded(catalog: Path = RECORDINGS_CATALOG) -> tuple[dict, ...]:
    try:
        clips = {item["id"]: item.get("text") for item in json.loads(Path(catalog).read_text())["clips"]
                 if isinstance(item, dict) and isinstance(item.get("id"), str)}
    except (OSError, ValueError, KeyError, TypeError):
        return ()

    def text(clip_id: str) -> str | None:
        value = clips.get(clip_id)
        value = " ".join(value.split()) if isinstance(value, str) else ""
        return value if 0 < len(value) <= TEXT_LIMIT else None

    seats = []
    while True:
        seat = len(seats) + 1
        decision_id = f"r1_member_{seat}_step_1"
        coaching_ids = tuple(f"r2_member_{seat}_step_{step}" for step in (1, 2, 3))
        decision, coaching = text(decision_id), tuple(text(clip_id) for clip_id in coaching_ids)
        if decision is None or not all(coaching):
            return tuple(seats)
        seats.append({"seat": seat, "decision": decision, "coaching": coaching,
                      "clip_ids": (decision_id, *coaching_ids)})
