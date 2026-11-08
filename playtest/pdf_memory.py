"""Local, page cited PDF retrieval with actual EmbeddingGemma vectors.

Model acquisition is an explicit build operation. Searches load cached weights
only. Retrieved PDF content is untrusted evidence, never application authority.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import threading
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = "google/embeddinggemma-2"
REVISION = "f9972ac22e696a105c482202646979e33e4b5a1e"
DEFAULT_CACHE = ROOT / ".local/ai-playtest/pdf-memory"
CATALOG = ROOT / "playtest/fixtures/pdf-memory-catalog.json"
MAX_BYTES = 5 * 1024 * 1024
MAX_PAGES = 30
INDEX_VERSION = 2


class MemoryNotReady(RuntimeError):
    pass


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, path)


class PDFMemory:
    def __init__(self, cache_dir=None, catalog_path=None, *, encoder=None):
        self.cache_dir = Path(cache_dir or DEFAULT_CACHE).resolve()
        self.catalog_path = Path(catalog_path or CATALOG)
        self.index_path = self.cache_dir / "index.json"
        self.uploads_path = self.cache_dir / "uploads.json"
        self.model_path = self.cache_dir / "model"
        self._encoder = encoder  # Dependency injection for invariant unit tests only.
        self._lock = threading.RLock()
        self._index_cache = None
        self._index_mtime = None

    def _documents(self):
        docs = []
        if self.catalog_path.exists():
            for item in json.loads(self.catalog_path.read_text())["documents"]:
                doc = dict(item)
                path = (ROOT / doc.pop("path")).resolve()
                if not path.is_relative_to((ROOT / "output/pdf").resolve()):
                    raise ValueError("Demo PDF path is outside the allowed directory")
                doc["_path"] = path
                docs.append(doc)
        if self.uploads_path.exists():
            for item in json.loads(self.uploads_path.read_text()):
                doc = dict(item)
                path = (self.cache_dir / "uploads" / doc["stored_name"]).resolve()
                if not path.is_relative_to(self.cache_dir / "uploads"):
                    raise ValueError("Invalid stored PDF path")
                doc["_path"] = path
                docs.append(doc)
        return docs

    def document_path(self, document_id):
        for doc in self._documents():
            if doc["id"] == document_id:
                return doc["_path"]
        raise KeyError("Unknown PDF document")

    def _index(self):
        if not self.index_path.exists():
            return None
        stat = self.index_path.stat()
        marker = (stat.st_mtime_ns, stat.st_size)
        if marker != self._index_mtime:
            self._index_cache = json.loads(self.index_path.read_text())
            self._index_mtime = marker
        return self._index_cache

    def _valid_index(self, index, docs):
        return bool(index and index.get("version") == INDEX_VERSION
                    and index.get("model") == MODEL and index.get("revision") == REVISION
                    and index.get("sources") == {d["id"]: _sha(d["_path"]) for d in docs}
                    and index.get("chunks") and len(index["chunks"]) == len(index.get("vectors", [])))

    def status(self):
        """Fast metadata only: never import torch or initialize the model."""
        try:
            docs = self._documents()
            index = self._index()
            ready = self._valid_index(index, docs)
            model_cached = (self.model_path / "model.safetensors").exists() or self._encoder is not None
            ready = ready and model_cached
            public = []
            for d in docs:
                public.append({**{k: v for k, v in d.items() if not k.startswith("_") and k != "stored_name"},
                               "demo": d.get("kind") == "demo"})
            return {"ready": bool(ready), "model": MODEL, "revision": REVISION,
                    "documents": public, "demo_document_ids": [d["id"] for d in public if d["demo"]],
                    "dimensions": 768, "model_cached": model_cached,
                    "note": "Page cited EmbeddingGemma memory is ready." if ready else
                    "Run python -m playtest.build_pdf_memory --download --index to prepare the local model and index."}
        except (OSError, ValueError, KeyError):
            return {"ready": False, "model": MODEL, "documents": [], "demo_document_ids": [],
                    "note": "PDF index is missing, changed or unreadable. Rebuild the local index."}

    def download_model(self):
        """Explicit operator setup only; inference never calls this method."""
        from huggingface_hub import snapshot_download
        self.model_path.mkdir(parents=True, exist_ok=True)
        snapshot_download(MODEL, revision=REVISION, local_dir=self.model_path,
                          allow_patterns=["*.json", "*.safetensors", "*.model", "*.jinja", "1_Pooling/*", "2_Normalize/*"])

    def _model(self):
        if self._encoder is None:
            if not (self.model_path / "model.safetensors").exists():
                raise MemoryNotReady("EmbeddingGemma weights are not cached; run the explicit download command.")
            import torch
            from sentence_transformers import SentenceTransformer
            # CPU float32 is supported on Intel and Apple Silicon. Avoid float16,
            # which is unsupported by this model's activations.
            torch.set_num_threads(min(4, os.cpu_count() or 1))
            self._encoder = SentenceTransformer(str(self.model_path), device="cpu", local_files_only=True,
                config_kwargs={"vision_config": None, "audio_config": None},
                model_kwargs={"dtype": torch.float32})
        return self._encoder

    def _encode(self, texts, query=False):
        # Must be called with self._lock held: loading and encoding are serialized.
        prompt = {"prompt_name": "QuestionAnswering"} if query else {"prompt": ""}
        return self._model().encode(texts, **prompt,
                                    normalize_embeddings=True, convert_to_numpy=True,
                                    batch_size=8, show_progress_bar=False)

    @staticmethod
    def _pages(data):
        if not data or len(data) > MAX_BYTES or not data.startswith(b"%PDF-"):
            raise ValueError("Provide a PDF up to 5 MB.")
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ValueError("Encrypted PDFs are not supported.")
            if not 1 <= len(reader.pages) <= MAX_PAGES:
                raise ValueError("PDFs must have 1 to 30 pages.")
            pages = [p.extract_text() or "" for p in reader.pages]
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("The PDF could not be read.") from exc
        if not any(len(re.sub(r"\s", "", p)) >= 20 for p in pages):
            raise ValueError("PDF has no usable text. Scanned PDFs require OCR before upload.")
        return pages

    @staticmethod
    def _chunks(doc, pages):
        chunks = []
        for page_no, page in enumerate(pages, 1):
            # Clause identifiers survive the PDF text extraction, improving exact
            # evidence boundaries. Arbitrary uploads use bounded text windows.
            parts = re.split(r"(?m)(?=^T0[123]-[A-Z]+(?::[A-Z]+-\d+)?\s*$|^Shared participant instructions$)", page)
            # Keep clauses from the same authored document together. Splitting
            # payment approval from provisioning requirements loses the context
            # needed to answer a payroll question correctly.
            grouped = []
            previous = None
            for part in parts:
                match = re.match(r"^(T0[123]-[A-Z]+)(?::|\s)", part)
                source = match.group(1) if match else None
                if source and source == previous:
                    grouped[-1] += "\n" + part
                else:
                    grouped.append(part)
                previous = source
            for part in grouped:
                part = part.strip()
                while part:
                    end = min(len(part), 1100)
                    if end < len(part):
                        split = part.rfind(" ", 500, end)
                        if split != -1:
                            end = split
                    text = part[:end].strip()
                    part = part[end:].strip()
                    if len(text) < 30:
                        continue
                    chunks.append({"id": f"{doc['id']}:p{page_no}:c{len(chunks)+1}",
                                   "document_id": doc["id"], "title": doc["title"],
                                   "page": page_no, "text": text})
        return chunks

    def build_index(self):
        with self._lock:
            docs = self._documents()
            chunks = []
            for doc in docs:
                chunks.extend(self._chunks(doc, self._pages(doc["_path"].read_bytes())))
            if not chunks:
                raise ValueError("No PDF text is available to index.")
            # Explicit title formatting follows the publisher's document prompt.
            texts = [f"title: {c['title']} | text: {c['text']}" for c in chunks]
            vectors = self._encode(texts)
            import numpy as np
            vectors = np.asarray(vectors, dtype=np.float32)
            if vectors.shape != (len(chunks), 768) or not np.isfinite(vectors).all():
                raise ValueError("EmbeddingGemma returned invalid vectors.")
            index = {"version": INDEX_VERSION, "model": MODEL, "revision": REVISION,
                     "sources": {d["id"]: _sha(d["_path"]) for d in docs},
                     "chunks": chunks, "vectors": vectors.tolist()}
            _write_json(self.index_path, index)
            self._index_cache = None
            self._index_mtime = None
            return {"documents": len(docs), "chunks": len(chunks), "dimensions": 768}

    def search(self, question, document_ids=None, limit=5):
        """Retrieve allowed PDF pages. None scopes to demo docs, never all uploads."""
        question = str(question).strip()
        if not question or len(question) > 4000:
            raise ValueError("A question of 1 to 4000 characters is required.")
        with self._lock:
            docs = self._documents()
            known = {d["id"] for d in docs}
            allowed = {d["id"] for d in docs if d.get("kind") == "demo"} if document_ids is None else set(document_ids)
            if not allowed <= known:
                raise ValueError("Unknown or unavailable PDF document IDs.")
            if not allowed:
                return []
            index = self._index()
            if not self._valid_index(index, docs):
                raise MemoryNotReady("PDF text changed or index is missing; rebuild before retrieval.")
            import numpy as np
            selected = [i for i, chunk in enumerate(index["chunks"]) if chunk["document_id"] in allowed]
            query = np.asarray(self._encode([question], query=True), dtype=np.float32)[0]
            matrix = np.asarray([index["vectors"][i] for i in selected], dtype=np.float32)
            scores = matrix @ query
            order = np.argsort(-scores, kind="stable")[:max(1, min(int(limit), 10))]
            return [{**index["chunks"][selected[int(i)]], "score": round(float(scores[i]), 6)} for i in order]

    def add_pdf(self, data, filename):
        """Ingest a text PDF, returning an opaque ID to attach to one room.

        Caller MUST enforce room membership and pass that room's allowed IDs to
        search/document download. This storage layer has no authentication state.
        """
        pages = self._pages(data)
        name = Path(str(filename).replace("\\", "/")).name
        name = re.sub(r"[\x00-\x1f]", "", name)[:120]
        if not name.lower().endswith(".pdf"):
            raise ValueError("Filename must end in .pdf.")
        document_id = "upload-" + uuid.uuid4().hex
        metadata = {"id": document_id, "title": Path(name).stem[:100], "filename": name,
                    "pages": len(pages), "kind": "upload", "stored_name": document_id + ".pdf"}
        with self._lock:
            uploads = json.loads(self.uploads_path.read_text()) if self.uploads_path.exists() else []
            dest = self.cache_dir / "uploads" / metadata["stored_name"]
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            uploads.append(metadata)
            _write_json(self.uploads_path, uploads)
            try:
                self.build_index()
            except Exception:
                uploads.pop()
                _write_json(self.uploads_path, uploads)
                dest.unlink(missing_ok=True)
                raise
        return {k: v for k, v in metadata.items() if k != "stored_name"}
