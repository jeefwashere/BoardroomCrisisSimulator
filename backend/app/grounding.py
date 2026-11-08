"""Embedding retrieval for AI replies: send the model the scenario passages most relevant to what is being said.

The reply prompt has room for about 2 KB of documents. Without retrieval it takes the opening of each document;
with Google embeddings (gemini-embedding-001) it takes the passages closest to the speaker's role, the latest
contributions or the coach's question. Passage vectors are cached for the life of the process, so after the first
reply only the short query is embedded (about 0.4 seconds). Any failure falls back to the plain documents.
"""

import asyncio
import hashlib
import math

PASSAGE_CHARACTERS = 480
QUERY_TIMEOUT_SECONDS = 4


def passages(context: dict) -> list[tuple[str, str]]:
    """Split public documents and attached report sections into labelled passages of about 480 characters."""
    found: list[tuple[str, str]] = []
    sources = [(identity, text) for identity, text in context.get("documents", ())]
    for report in context.get("attached", ()):
        sources += [(f"{report['title']}: {title}", body) for title, body in report.get("sections", ())]
    for label, text in sources:
        words, part = " ".join(str(text).split()).split(" "), []
        for word in words:
            part.append(word)
            if sum(len(item) + 1 for item in part) >= PASSAGE_CHARACTERS:
                found.append((label, " ".join(part)))
                part = []
        if part and any(part):
            found.append((label, " ".join(part)))
    return found


def _unit(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / norm for x in vector]


class Grounding:
    def __init__(self, vertex):
        self.vertex = vertex
        self.vectors: dict[str, list[float]] = {}

    @staticmethod
    def _key(text: str) -> str:
        return hashlib.sha256(text.encode()).hexdigest()

    async def select(self, context: dict, query: str, limit: int = 2200) -> list[tuple[str, str]] | None:
        """The most relevant passages within `limit` characters, best first; None when retrieval is unavailable."""
        if not getattr(self.vertex, "configured", False) or not hasattr(self.vertex, "embeddings") or not query.strip():
            return None
        items = passages(context)
        if len(items) < 2:
            return None
        try:
            missing = [text for _, text in items if self._key(text) not in self.vectors]
            jobs = [self.vertex.embeddings([query[:2000]], "RETRIEVAL_QUERY")]
            if missing:
                jobs.append(self.vertex.embeddings(missing, "RETRIEVAL_DOCUMENT"))
            results = await asyncio.wait_for(asyncio.gather(*jobs), QUERY_TIMEOUT_SECONDS)
        except Exception:
            return None
        for text, vector in zip(missing, results[1] if missing else ()):
            self.vectors[self._key(text)] = _unit(vector)
        probe = _unit(results[0][0])
        ranked = sorted(items, key=lambda item: -sum(a * b for a, b in zip(probe, self.vectors[self._key(item[1])])))
        chosen, used = [], 0
        for label, text in ranked:
            if used + len(text) > limit:
                continue
            chosen.append((label, text))
            used += len(text)
        return chosen or None
