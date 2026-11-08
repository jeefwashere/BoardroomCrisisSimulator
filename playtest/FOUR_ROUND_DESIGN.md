# Four round board crisis exercise

Confirmed user design. Round 1 is a group session. Rounds 2 and 3 are private sessions between one human board member and one AI agent. Round 4 reunites everyone. The opening preparation agent remains at the beginning of Round 1, using Gemma document retrieval, Gemini text and ElevenLabs speech.

During private sessions, one agent presents developments, asks questions, listens to the response and conducts the challenge. Other experts do not join that conversation. Each private session is an alternative branch of the same crisis. One member's decisions must not change another member's test. Reunion compares branches rather than pretending their different actions happened together.

| Round | Participants | Purpose | Points |
| --- | --- | --- | --- |
| 1. Board discussion | All humans, facilitator and three expert agents | Discuss the crisis, hear perspectives and submit individual decisions | None |
| 2. Private preparation | One human and one crisis coach | Introduce a twist and develop a workable response | None |
| 3. Private assessment | The same human and the same agent as examiner | Challenge the response and assess decisions and communication | Up to 100 |
| 4. Board reunion | Everyone together | Compare branches, explain scores, announce the winner and identify improvements | No new points |

## Round 1: discuss together, decide individually

The preparation agent introduces the crisis and documents. The facilitator supports group discussion. Humans discuss their concerns and possible responses. Then three experts respond to what the board discussed:

1. IT/security: technical facts, uncertainty and risk.
2. Operations/community services: effects on staff and community members.
3. Governance/finance: authorization, resources and responsibilities.

After hearing them, each human submits an individual decision: “I would do this, for these reasons, using this information. These are the things I still need to establish.” The decision becomes that member's private session starting point. There is no group winning ballot, CEO override, score or leaderboard in this round. The CEO still controls starting and closing the shared meeting.

## Round 2: private coaching to make a plan workable

Sessions can run simultaneously. Each member has one crisis coach that knows the original crisis and public documents, expert explanations, the member's discussion contributions and their submitted decision. The coach introduces a twist: “The IT specialist is now unavailable. Your original response relied on their advice. Talk me through what you would do next.”

Ask one question at a time and follow the member's reasoning. For example:

> Member: I would find another IT provider.
>
> Agent: What would you need to establish before engaging them?
>
> Member: Their availability, cost and whether they can access our systems.
>
> Agent: Who can authorize that access under your plan?
>
> Member: I am not sure. I would check the delegation policy.
>
> Agent: You can open that document here. Once you have checked it, explain who you would contact and what you would ask them to do.

The coach supplies only approved scenario information or points to available documents. Missing information stays unknown. The example delegation document must actually exist before the interface offers it. If another person's response is needed, the same coach presents the approved update: “The alternate provider can investigate, but needs an authorized contact.” No provider agent joins.

End with a response card the member confirms or corrects:

| Field | Meaning |
| --- | --- |
| Action | Intended action |
| Responsibility | Who acts and who authorizes |
| Evidence | Support for the response |
| Dependencies | What must be available first |
| Fallback | What happens if the action cannot proceed |
| Communication | Who needs an update and what to tell them |
| Review | When progress will be checked |

Nothing earns points in Round 2. It is coached preparation.

## Round 3: the same agent becomes the examiner

Make the transition explicit: “Your preparation is complete. The scored challenge begins now. I will ask you to explain your response and adapt to new information.” The agent remains the only conversational partner.

| Coaching behaviour in Round 2 | Examiner behaviour in Round 3 |
| --- | --- |
| Helps identify missing steps | Tests whether the member resolves a problem |
| Offers document pointers | Makes the same documents available without supplying answers |
| Helps structure the response | Asks the member to explain and commit |
| Gives formative guidance | Records evidence for scoring |

### Stage 1: explain your decision, 30 points

“Explain your response as if you were briefing the rest of the board. What should happen first, and why?”

1. Accurate use of facts and uncertainty: 10.
2. Clear reasoning: 10.
3. Clear, relevant communication: 10.

### Stage 2: respond to a challenge, 40 points

“The alternate provider cannot begin immediately. Staff still need instructions. What changes in your plan?”

1. Recognizes the new constraint: 10.
2. Proposes a feasible adjustment: 10.
3. Explains the tradeoff: 10.
4. Addresses the question and relevant concerns: 10.

### Stage 3: give your final instruction, 30 points

“Give me the instruction you would communicate now: who does what, what happens if it fails, and when you will review it.”

1. Clear action, owner and appropriate authority: 10.
2. Workable fallback: 10.
3. Clear update and review arrangement: 10.

Communication means understandable, relevant and responsive. Do not score confidence, speaking speed or accent. Allow typed or spoken answers and correction of transcription errors before submission. Show cumulative points after each submitted stage. Release detailed coaching only after assessment so feedback does not reveal later answers.

## Round 4: reunite and compare

The facilitator explains each member's original approach, private adaptation, Round 3 score and supporting evidence, and one strength and improvement. Members may flag overlooked responses before the winner is announced. Corrections use the existing Round 3 record; new arguments do not earn points. The highest final score wins. Finish with: “Having heard everyone's approach, what should this board change in its actual plan?”

## Timing and implementation boundary

The suggested 15 minute version is five minutes together, three minutes private coaching, four minutes private assessment, then three minutes together for results. This is a target schedule, not permission to invent missing responses or scores.

All four rounds now run in the isolated three member T01 beta. The opening remains 30 seconds and group discussion allows up to five minutes with early finish. Experts, individual submissions, private coaching, response card confirmation, assessment and reunion wait for their completion gates. The proposed 15 minute total is not enforced. Beta mode fixes question order to match the saved human answers; adaptive mode uses live Gemini follow ups. Both modes preserve private isolation and the Round 3 rubric. See [the implemented workflow](FOUR_ROUND_WORKFLOW.md) and [verification report](FOUR_ROUND_REPORT.md).
