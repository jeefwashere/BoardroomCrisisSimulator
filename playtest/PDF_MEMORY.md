# Preparation memory from participant PDFs

The preparation service retrieves page cited text from three public demo PDFs using actual local EmbeddingGemma vectors. The generation of the preparation answer remains the existing Gemini Flash responsibility. EmbeddingGemma supplies evidence; it does not decide votes, assign roles or rewrite the meeting record.

## Documents

The index retains the three public demo packs below. The simplified X11 meeting automatically attaches only T01 to a new room; preparation searches only the documents attached to that room. Other packs remain available as developer reference files.

| ID | Public participant pack | PDF |
| --- | --- | --- |
| T01 | Service outage and unavailable director | [Open PDF](../output/pdf/demo-t01-service-outage.pdf) |
| T02 | A fundraising allegation reaches the media | [Open PDF](../output/pdf/demo-t02-fundraising.pdf) |
| T03 | Two leaders unavailable before payroll | [Open PDF](../output/pdf/demo-t03-succession-payroll.pdf) |

Each PDF has two pages, preserved clause identifiers and a page footer. The only source is `playtest/fixtures/participant-packs.json`. The controller reference, hidden events, test answers and reviewer guides are never loaded. These are fictional reference packs; the live application's CEO and voting rules remain authoritative.

## Model and setup

The model is `google/embeddinggemma-2`, pinned to revision `f9972ac22e696a105c482202646979e33e4b5a1e`. It uses the publisher's text only configuration with `vision_config=None` and `audio_config=None`, CPU float32 and 768 dimensional normalized vectors. The query uses the `QuestionAnswering` prompt. Each document chunk uses the published `title: ... | text: ...` format. [Google model card](https://huggingface.co/google/embeddinggemma-2) and [official setup guide](https://ai.google.dev/gemma/docs/embeddinggemma/inference-embeddinggemma-with-sentence-transformers).

Install in the application virtual environment, never the system Python:

```sh
uv pip install --python .venv/bin/python -r playtest/requirements-memory.txt
.venv/bin/python -m playtest.build_pdf_memory --download --index --evaluate
```

Downloads only occur when the operator explicitly passes `--download`. Search uses locally cached weights with `local_files_only=True`. It does not call Vertex, ElevenLabs, Hugging Face inference endpoints or Velocity. The initial upstream checkpoint includes all modalities on disk; only the text encoder is instantiated. Model weights and the index are ignored under `.local/ai-playtest/pdf-memory/`.

`--create-demo-pdfs` regenerates the three demo PDFs and their allowlisted catalog. Existing public PDF artifacts are already included, so a normal setup does not need that option. The creation workflow executed the PDF artifact marker once, generated with ReportLab and rendered all six pages with PDFium because Poppler was unavailable. All six rendered pages were visually inspected for clipping, broken text and page layout.

## Application contract

1. `PDFMemory().status()` returns readiness, model identity, document metadata, `demo` flags and `demo_document_ids`. It never imports or initializes Torch. A missing index or changed PDF checksum makes readiness false.
2. `search(question, document_ids, limit=5)` returns `id`, `document_id`, `title`, `page`, `text` and cosine `score`. Pass only document IDs attached to the requesting room. An empty list retrieves nothing; unknown IDs raise an error. Omitting IDs searches only the public demo PDFs, never uploads.
3. `document_path(id)` resolves only known catalog or upload entries. The HTTP endpoint must check room membership and document assignment before calling it.
4. `add_pdf(data, filename)` accepts text PDFs up to 5 MB and 30 pages, creates an opaque document ID, saves the source and rebuilds the index. It rejects blank, scanned, encrypted and invalid PDFs. Assign its returned ID only to the uploading room. Uploaded documents are never automatically public.
5. Run retrieval and upload/indexing outside the asynchronous event loop, for example with `asyncio.to_thread`. The service serializes model loading and encoding with an internal lock. Never hold a room state lock while waiting for retrieval.
6. Treat all retrieved text as untrusted source material. Neither uploaded instructions nor query text can expand the explicit document scope. The answer generation prompt must also tell the assistant to use evidence as data and cite exact PDF pages.

The cache persists `index.json`, source checksums, normalized vectors and chunk metadata. File changes require an explicit index rebuild before search. Upload metadata uses an atomic JSON write. Indexing failure rolls back the new upload. The service is intended for the single process local playtest, not a distributed multiwriter deployment.

## Verification

```sh
.venv/bin/python -m unittest playtest.tests.test_pdf_memory -v
uv pip check --python .venv/bin/python
.venv/bin/python -m playtest.build_pdf_memory --evaluate
```

The seven invariant tests verify explicit document scope even with hostile instruction text, source checksum invalidation and rebuilding, exact page citation, invalid/blank/scanned/oversize rejection, safe filenames, encrypted and excessive page rejection, failed upload rollback and metadata reads without inference. These tests inject a small deterministic encoder to isolate storage behavior. They do not represent model quality tests.

The separate live evaluation uses actual EmbeddingGemma and writes full cited results to `.local/ai-playtest/pdf-memory/evaluation.json`. Latency measures local retrieval, excluding Gemini answer generation and speech. The test host is an Apple M3 with 16 GB RAM. These are three smoke queries during concurrent development, not a broad model benchmark or an accuracy guarantee.

The initial implementation split every source clause into its own chunk. In that 45 chunk baseline, the expected evidence appeared in the top three results for T01 and T02, but T03 missed the separate payment provisioning clause. T03 did retrieve the two approval requirement, which was relevant but insufficient for the whole question. The preserved baseline is `.local/ai-playtest/pdf-memory/evaluation-baseline.json`.

| Baseline query | Retrieval time | Expected evidence in top three |
| --- | --- | --- |
| T01 restoration promise | 1,516.9 ms | Yes |
| T02 supplier conflict | 1,782.6 ms | Yes |
| T03 payroll appointment | 762.5 ms | No |

The revised chunker preserves adjacent clauses from the same authored document on the same page. This retains the relationship between payroll approval and payment access while still ranking with real Gemma vectors. The initial baseline load plus indexing took 85,198.6 ms. A separately measured final cold model initialization took 87,403.6 ms; it loaded 271,002,624 parameters as CPU float32. `status.ready` describes the durable index and cached weights, not whether the process has warmed its model. Warm the application service before measuring interactive latency.

The final index contains 26 chunks across six PDF pages and 768 coordinates per vector. Indexing after model initialization took 37,138.6 ms. All three expected evidence checks passed in the top three results using the explicit scope `[T01]`, `[T02]` or `[T03]` for the corresponding question. This is not a test of mixed document retrieval.

| Final query | Warm retrieval time | Required evidence rank | Cosine score of required evidence | Exact citation |
| --- | --- | --- | --- | --- |
| T01 restoration promise | 789.7 ms | 3 | 0.674693 | `T01:p1:c3`, page 1 |
| T02 supplier conflict | 588.8 ms | 1 | 0.711423 | `T02:p1:c3`, page 1 |
| T03 payroll appointment | 497.6 ms | 1 | 0.768892 | `T03:p1:c4`, page 1 |

The warm median was 588.8 ms across these three queries. Preserve at least three retrieved chunks for these checks: T01's first result alone does not contain the full restoration prerequisite. Cosine scores express retrieval similarity, not calibrated truth probabilities. The generated answer still needs to select relevant evidence, preserve unknowns and include citations. Model readiness, source integrity and retrieval scope are enforced by code; answer quality requires separate review.

The final seven unit tests passed after the chunker change. `uv pip check` validated all 56 installed packages, including the shared processor's required `torchvision==0.29.2`; the vision encoder remains disabled. Every public clause identifier was verified in the extracted PDF text. No Vertex, ElevenLabs or GPU cluster calls were made by this PDF memory work. Full final vectors, baseline and final retrieval results, and the runtime measurements remain under the ignored cache directory.

## Manual preparation checks

1. In T01, ask: “What must IT verify before we promise when service will return?” The evidence should include `T01-BCP:BCP-4` on page 1, covering usable backups, recovery dependencies and a restoration estimate.
2. In T02, ask: “Can the treasurer approve a review of transactions involving his printing company?” The evidence should include `T02-GOV:GOV-2` on page 1 and preserve the conflict restriction.
3. In T03, ask: “Does appointing an acting director immediately let them release payroll?” The evidence should include `T03-ACCESS:ACCESS-1` and `T03-ACCESS:ACCESS-2` on page 1. Appointment and payment access are separate requirements.
4. Upload a text PDF to one room, then create another room. Only the first room should list or retrieve that upload. A PDF that contains instructions to reveal other rooms cannot change the room's retrieval scope.

These expected checks are documentation for reviewers and are not included in the retrieval corpus.
