# MapleCart: a cybersecurity crisis in 18 minutes

Version 1. Fictional scenario draft for the Boardroom Crisis Simulator. Recommended group: 3 to 6 players. The current application capacity is 30. The immutable version 1 data retains its original 20 seat planning metadata; it is not the current application capacity rule. A revised scenario version is needed before using that metadata for the new Start handoff. This is a playable script and data draft, not a running backend or a validated training programme.

## 1. Research behind the format

The UK NCSC's [Responding to a ransomware attack micro exercise](https://www.ncsc.gov.uk/sites/default/files/documents/responding-to-a-ransomware-attack-micro-exercise.pdf), page 2, suggests roughly 15 to 30 minutes and recommends a facilitator with a small group of 3 to 5 people. Its format combines a situation, group discussion, and reflection. The Australian Signals Directorate's [Exercise in a Box](https://www.cyber.gov.au/exercise-in-a-box) also distinguishes micro exercises of 15 to 30 minutes from discussion exercises of 30 to 120 minutes.

Those sources support using a short, focused format. The exact 18 minute schedule, voting mechanics, MapleCart story, choices, consequences, and game meters below are original design proposals for this project. No source establishes that five minutes per round is a universal standard. The schedule has been checked arithmetically but has not been tested with players.

## 2. Timing

Measure time from the beginning of the public briefing, not from opening the website or joining the lobby. Lobby setup is outside the game duration.

1. `00:00 to 01:30`: read the public briefing and assign combined responsibilities if needed.
2. `01:30 to 06:30`: round 1, containment.
3. `06:30 to 11:30`: round 2, communication.
4. `11:30 to 16:30`: round 3, recovery.
5. `16:30 to 18:00`: results and debrief.

Every normal round reserves five minutes:

1. 60 seconds to read the new evidence and review the three public documents.
2. 150 seconds for sequential speaking and any remaining shared discussion.
3. 60 seconds to vote.
4. 30 seconds to evaluate a custom winner if needed, apply the result, and display it.

Allocate each player's speaking slot as the smaller of 30 seconds and `floor(150 / player_count)` seconds. Three players get 30 seconds each plus 60 seconds of open discussion. Five players get 30 seconds each. Six players get 25 seconds each. Unused speaking time remains available for discussion rather than removing the investigation period.

Voting remains 60 seconds even when everyone votes early. A tie adds up to 30 seconds for the CEO, giving up to 19 minutes 30 seconds if all three rounds tie. AI evaluation uses the existing 30 second result window, not another unrestricted phase. Allow one attempt of up to 15 seconds; a permitted retry uses only the result window's remaining time. On failure, show the selected action as unresolved and follow the specification's visible failure handling. Do not invent a successful result to keep the schedule.

The full experience has a 20 minute target ceiling. Reserve the final 90 seconds for debrief, so gameplay must end no later than 18 minutes 30 seconds after the briefing began. If the backend's session timer starts after the briefing, its gameplay ceiling is 17 minutes. A provider failure or facilitator intervention can consume the 30 second reserve after the maximum tie schedule; further delay ends play with an incomplete result. These are proposed scenario specific limits, not changes to every room's defaults.

A faster 15 minute profile uses 30 seconds of reading, 120 seconds of discussion, 60 seconds of voting, and 30 seconds of results per round, plus the same briefing and debrief. Ties can extend that profile to 16 minutes 30 seconds.

For 30 players, the 150 second speaking pool allows 5 seconds per person. If all 30 instead receive 30 seconds in every round, the base schedule becomes 55 minutes 30 seconds. Use a smaller demo group, shorter statements, or an explicitly agreed representation format. Do not promise 30 people a full 30 second turn each while also promising an 18 minute game.

## 3. Public documents and setup

Share these documents with every player:

1. [Company and role briefing](../../scenarios/cybersecurity_demo/v1/briefing.md).
2. [Initial evidence](../../scenarios/cybersecurity_demo/v1/initial-evidence.md).
3. [Service and recovery notes](../../scenarios/cybersecurity_demo/v1/operations.md).

The company, records, deadlines, incident facts, and outcomes are fictional. No real attack or live system action is performed. Initial meters are service continuity 60, data protection 60, and public trust 60, each bounded from 0 to 100. These are educational game values chosen for this draft.

The facilitator owns the complete script. Players should see only the current situation, public documents, and action labels. Do not expose unreached updates or outcome deltas as part of the player view. All players receive the same facts; there is no private role information.

Suggested three player role pairing: CEO with finance, security with technology, and operations with communications and privacy. A larger group separates these responsibilities. Only one player holds the CEO authority.

## 4. Round 1: stop the spread without guessing

Story time: 14:00. Real play window: five minutes.

Read aloud:

> Three finance laptops are locked by a ransom demand. The finance integration account has attempted an unusual customer export. Checkout still works, but the investigation is incomplete. The promotion begins in one simulated hour. You must choose the first coordinated action.

Study prompts:

1. What do we know, and what do we still need to establish?
2. Which affected access can we restrict while preserving evidence?
3. What business work can safely continue under monitoring?

Prepared choices:

1. A. Isolate the affected finance devices and bridge, suspend the suspicious account, preserve available logs, and appoint an incident lead. Keep the separate storefront under active monitoring.
2. B. Keep all systems running until the promotion finishes and ask the team to investigate quietly in the background.
3. C. Disconnect all business systems immediately, suspend the promotion, and accept a broad outage while the team determines the affected scope.
4. Custom. Propose a different concrete action during discussion.

Authored consequences:

1. A gives a narrower investigation boundary. The next update confirms an export of 160 customer records before the account was suspended. It does not claim that containment proves the incident is completely resolved. Meter changes: service minus 5, protection plus 20, trust unchanged.
2. B preserves short term availability but gives the incident more time to develop. The next update confirms an export of 5,000 customer records and additional finance disruption. Meter changes: service plus 5, protection minus 25, trust minus 10.
3. C limits continued connected activity, but checkout and support tools become unavailable. Investigators can currently confirm 160 exported records; completeness is still uncertain. Meter changes: service minus 25, protection plus 10, trust minus 5.
4. No decision gives the same observed escalation as waiting, without attributing an affirmative choice to the team. Meter changes: service minus 10, protection minus 20, trust minus 5.

Demo happy path: A. The facilitator should still invite discussion of when broader containment would be warranted. The option is preferred for the explicit dependencies in this fictional case, not as a universal incident response instruction.

## 5. Round 2: communicate what you actually know

Story time: 14:20. Real play window: five minutes.

Read aloud, using the actual round 1 consequence:

> The incident team has now confirmed that a customer export occurred. Its current verified count is 160 records after A or C, or 5,000 after B or no decision. The investigation has not established the complete exposure. A journalist asks whether customer information is safe. Marketing needs a status message before the promotion.

Also carry forward the service condition. If C was chosen, checkout is offline. Otherwise report the narrower restriction or growing finance disruption already recorded. The story must not reset every group to an identical healthy system.

Study prompts:

1. Which statements can we support with the available evidence?
2. What can we say without falsely declaring either complete safety or complete knowledge of the incident?
3. Who owns the next customer update and any privacy assessment?

Prepared choices:

1. A. Publish a limited factual notice: some internal services are disrupted, a customer data incident is being investigated, and the next update will arrive in 30 simulated minutes. Assign the privacy lead to assess notification duties and avoid claiming a final scope.
2. B. Describe the issue only as maintenance and state that customer data is definitely safe so the promotion can proceed confidently.
3. C. Say nothing publicly until the investigation is complete, while briefing only major business partners.
4. Custom. Propose a factual communication and coordination plan.

Authored consequences:

1. A establishes an accountable update cadence and avoids unsupported certainty. Meter changes: service unchanged, protection plus 5, trust plus 20. The known export count remains the one established by round 1.
2. B is contradicted by the verified export. The next update includes screenshots of the earlier denial alongside customer questions. Meter changes: service plus 5, protection minus 5, trust minus 25.
3. C leaves customers without a consistent explanation as questions spread. Meter changes: service unchanged, protection unchanged, trust minus 10.
4. No decision misses the planned communication window. Meter changes: service unchanged, protection unchanged, trust minus 15.

Demo happy path: A. A good custom answer may use different wording and still receive the same outcome if it preserves accuracy, ownership, and follow through. No fictional choice defines a real legal notification deadline.

## 6. Round 3: recover deliberately

Story time: 14:40. Real play window: five minutes.

Read aloud:

> Technology staff have found an isolated 13:00 backup and propose a controlled recovery. Validation and restoration will take at least 45 simulated minutes. Marketing's original promotion time is now 20 simulated minutes away. Support can accept a limited manual queue of 200 orders. Leadership needs a recovery decision, not a claim that recovery has already finished.

Carry forward the earlier state. After broad shutdown, restoring customer access is urgent. After weak containment, the plan must also address the larger unresolved exposure. After an inaccurate public statement, the next notice must explicitly correct that statement.

Study prompts:

1. What evidence is needed before restored systems are trusted?
2. Which limited service can continue while validation proceeds?
3. Who owns recovery and the next progress report?

Prepared choices:

1. A. Begin staged recovery in a validated environment, address compromised access, use the limited manual process, and move the promotion while publishing an owned recovery plan and the next update time.
2. B. Reconnect the existing production environment immediately and use an unverified snapshot to meet the promotion deadline.
3. C. Cancel the promotion and keep systems isolated while conducting a full rebuild with a named owner, customer arrangements, and a 24 simulated hour planning horizon.
4. Custom. Propose another recovery plan with explicit prerequisites and responsibilities.

Authored consequences:

1. A produces a controlled recovery plan with reduced near term capacity. The game ends with validation and recovery still in progress, not with proof that systems are clean. Meter changes: service plus 20, protection plus 10, trust plus 10.
2. B offers immediate availability at the cost of accepting unresolved integrity and access risks. The game records a risky restoration decision; it does not need to invent a second attack to explain the tradeoff. Meter changes: service plus 25, protection minus 25, trust minus 15.
3. C prioritizes assurance through a slower recovery. It is a defensible alternative for a cautious team that accepts the business cost. Meter changes: service minus 15, protection plus 15, trust plus 5.
4. No decision leaves recovery unowned at the end of the exercise. Meter changes: service minus 15, protection minus 5, trust minus 10.

Demo happy path: A, with C accepted as a coherent alternative when the team explains its tradeoff. Every prepared consequence and every meter value is a fictional teaching device.

## 7. Custom action adjudication

1. Collect one proposal per player during discussion. Freeze its text before voting.
2. A custom action is eligible to win the same equal weight vote as a prepared choice.
3. Only the winning custom action needs an AI deciding request. Supply current evidence, recorded earlier consequences, the selected text, this round's allowed outcomes, and the rubric.
4. For round 1, compare proportionate containment, evidence preservation, incident ownership, and continuity assumptions.
5. For round 2, compare factual accuracy, explicit uncertainty, customer impact, accountable updates, and privacy coordination.
6. For round 3, compare validation prerequisites, access risk, staged continuity, owners, and realistic recovery timing.
7. Map the proposal to a prepared outcome only when its substance fits. An honest alternative need not use the facilitator's preferred wording. If it fits none of the authored outcomes, return `unable_to_map` for review rather than fabricate a new story edge.
8. Invalid output, provider failure, or an unmappable choice remains visibly unresolved. The room may use its remaining permitted retry time or finish with a partial record. A late response cannot change an ended session.

Integration follows the selected [AI architecture](../ai-architecture.md). This content package does not change the chosen providers or connect itself to the existing rehearsal prototype. The 15 second AI attempt budget is a proposed gameplay limit, not a verified latency of the shared model queue. The future adapter must send compact current evidence and allowed outcome IDs within the service's input limits rather than sending this entire facilitator script.

## 8. Happy path and debrief

The prepared A, A, A sequence ends with service 75, protection 95, and trust 90. These values measure this game's authored tradeoffs only. The team has a controlled recovery plan, a verified export of at least 160 records, and an ongoing incident that still requires real work in the fictional world.

Use the final 90 seconds for:

1. First 30 seconds: show the actual three decisions and final meters. If a choice is unresolved, state that directly.
2. Next 30 seconds: let the group identify one strong decision and one assumption it would investigate further.
3. Final 30 seconds: give concise feedback on containment, communication, and recovery ownership. Provide one specific improvement grounded in their actual choices.

An A, A, C ending has service 40, protection 100 after clamping, and trust 85. It reflects a more conservative recovery choice, not automatic failure. A weak path can recover some trust through later accurate communication, but later good choices do not erase earlier confirmed exposure.

For AI feedback, use the committed record and these rubric dimensions. Do not generate claims that malware was removed, affected customers were all found, notifications were legally sufficient, or recovery completed unless the game state actually establishes those facts.

## 9. Data artifact and validation boundary

The proposed data representation is [scenario.json](../../scenarios/cybersecurity_demo/v1/scenario.json). Its `schema_version` is explicitly `draft.1` because the application loader has not been implemented. It contains the timing profiles, public documents, role combinations, three nodes, options, permitted outcomes, carried facts, and expected happy path.

Static validation checks all references, the three step decision sequence, all 64 prepared and no decision combinations, metric bounds, expected happy path meters, and timing arithmetic. It does not establish playtest duration, AI quality, API compatibility, or live multiplayer behavior.
