# Round 1 group discussion and individual decisions

Branch: `experiment/ai-voice-playtest`. The complete [four round design](FOUR_ROUND_DESIGN.md) is saved. This change implements Round 1 only. New browser rooms at <http://127.0.0.1:8788/> use `board_round1`; the older CEO custom voting experiment remains a separate legacy room mode.

## Resulting flow

1. The existing preparation agent introduces the PDF with Gemma retrieval, Gemini Flash LOW and streaming ElevenLabs speech. The opening remains 30 seconds.
2. Humans discuss in turns for up to five minutes. Nine manual participant recordings remain, with two revised final clips that lead into expert advice and personal responses. Typed input and reviewed microphone transcription also work.
3. IT/security, operations/community services and governance/finance experts respond to the report and actual discussion. They run sequentially in the CEO window, with shared written perspective cards. The expert stage waits until all three finish; failures require an explicit retry and never count as completed advice.
4. Every member reviews and submits their own action, reasoning, evidence and unknowns. There is no winning board vote or scoring in this mode. Members can revise only their own response before completion.
5. The CEO completes Round 1 only when all members have submitted. Responses then freeze. Each member can export their own preparation context for future private coaching.

The facilitator remains available during the group session. Preparation, facilitator and expert speech are live. The old recorded voting guide does not run in this mode. The two new participant assets reserved 559 conservative speech units; all 51 earlier manifest entries and audio files were preserved. Saved playback makes no provider request. The current nine clips total about 139.74 seconds.

## Authority and context

The backend validates phase, membership, explicit submission, required fields, revision and completion. Models cannot submit a decision or assign points. All members can see submission status; snapshots expose only the requesting member's decision content. The single window test view explicitly controls three separate memberships, so the tester can switch among them.

The authenticated preparation context includes shared documents, the opening preparation, shared discussion, three expert perspectives, the member's own contributions and their own individual decision. Other members' individual decisions are excluded. Contexts are separate snapshots; modifying an exported copy cannot alter server state.

A microphone recording remains local until explicit transcription. The provisional text goes into the chosen decision field for correction. Submission still requires review and confirmation. No continuous recording or voice quality scoring was added.

## Verification

146 playtest Python tests, 31 existing tests and 37 Node UI tests passed, plus the authored prototype demo and JavaScript syntax. Final integrity checks also passed: 112 unique DOM IDs, current documentation links, Markdown and HTML guide copies, credential patterns, all 51 previous recording hashes and both new hashes. Eighteen relevant Python tests passed after the final prompt and API adjustments.

The new controlled clock HTTP test exercises opening preparation, all nine audio assets and commits, a failed expert followed by successful retry, the three perspectives, provisional decision transcription, separate submissions, completion and personal export. It rejects old ballot operations and confirms that old voting instructions do not enter the Round 1 model prompt.

The authority tests cover missing experts, an untimed expert stage, incomplete decisions, another member identity, submitted points, stale revisions, duplicate command IDs, freezing after completion, output copy isolation and absence of another member's decision in a snapshot or context. UI tests cover individual draft separation, explicit confirmation, expert sequencing, completion gates and suppression of legacy voting/evaluation calls.

The [complete live HTTP run](evaluations/round-one.json) used three scripted human memberships, real Gemma retrieval, live Gemini text and ElevenLabs PCM for preparation, facilitator and all three experts. It ended with three distinct frozen personal contexts and no points. All five streams completed. This validates transport and authority; audio was decoded, not played through browser speakers.

| Agent | First audio received | Stream completed | Generated speech duration |
| --- | --- | --- | --- |
| Preparation | 1.95 s | 3.73 s | 22.15 s |
| Facilitator | 2.19 s | 4.81 s | 40.31 s |
| IT/security | 1.57 s | 3.32 s | 24.38 s |
| Operations/community services | 1.82 s | 3.91 s | 24.06 s |
| Governance/finance | 1.70 s | 3.44 s | 25.36 s |

Stream completion measures receipt of generated PCM, not audible playback finishing. The browser queues and plays the full speech before moving to the next expert. Three perspectives therefore take longer than their network generation times.

## Response review

The opening correctly described the outage, unavailable director, unconfirmed disclosure and unverified backups. Operations connected continuity to board authorization and labelled paper supply readiness unknown. IT preserved uncertainty, though its response largely restated the report rather than deeply analyzing participant tradeoffs.

The initial governance response repeated a two vote threshold from an older participant instruction page in the PDF. The initial facilitator also framed some compatible actions as a binary choice. These observations are retained in the live evidence. The revised prompt filters the old T01 participant instruction chunk, excludes voting mechanics for this round and warns against false choices or implied safety guarantees.

The [targeted follow up](evaluations/round-one-review.json) completed real text requests for facilitator and governance after the fix. Governance discussed authorization, external IT spending limits and checking resources without prescribing a voting threshold. The facilitator no longer presented the two compatible actions as an either/or choice. These two text requests took 3.57 and 2.31 seconds respectively. This was a targeted review, not a complete second round run. The facilitator still phrased the absence of a documented alternate channel too absolutely; absence from the PDF should be treated as unknown, so human source review remains necessary.

## Scope and limits

Rounds 2 and 3 private conversations, approved twist handling, response cards, scoring, correction appeals and Round 4 reunion are documented but not implemented. The 15 minute design is a target; this prototype retains the earlier five minute discussion allowance and waits for experts and individual submissions rather than enforcing a five minute total Round 1.

Expert generation sees up to eighteen recent contributions, bounded to 400 characters each; the complete transcript is retained separately. The prototype is local, stores rooms in process memory and uses test memberships. Audio streams to the requesting browser; shared expert text is visible to other room members. Browser visuals, real microphone permissions and human listening quality remain manual checks. No Velocity service or teammate production module changed.

[Current manual test guide](ROUNDTABLE_GUIDE.md). Reproduce the live test with `python -m playtest.round_one_benchmark --live` using the existing shared provider ledgers.
