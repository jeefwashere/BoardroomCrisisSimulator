# Voting UI changes

Current update: [X16 extended conversation and custom responses](EXTENDED_CONVERSATION_REPORT.md) supersedes the three clip and prepared choices only limits below. The measurements in this earlier report remain historical.

Working branch: **`experiment/ai-voice-playtest`**.

Implementation: [4d113f6](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/4d113f64da2c273c91740a1b0f84851829c553bf). Published on the test branch; not merged into `main`.

## What changed

1. The voting panel asks each member by name which decision they choose. Their participant card shows **DECIDE NOW**.
2. The three fixed T01 responses appear as clickable choices: **Controlled continuity**, **Technical checks first**, and **Wait for the director**.
3. Clicking **Choose this response** creates a local draft. The member must click **Confirm my vote** to submit it.
4. First ballots follow the server enforced member order. Waiting members cannot vote ahead of their turn, and no member receives an automatic ballot.
5. In the single window test setup, the UI selects the next participant after confirmation. After everyone votes, it returns to the CEO. Separate participant browsers keep their own identities.
6. The CEO cannot record the result until all members have voted. A clear winner cannot be overridden; tied leading options require an explicit CEO choice.
7. Members can revise their own submitted choice before commitment using **Confirm changed vote**. A stale UI control cannot submit a vote for a different selected member.

The recorded decision guide and live evaluation remain in place. This change adds no model or speech calls.

## How to test

Open <http://127.0.0.1:8788/>, refresh and load a fresh three participant test room. Proceed through discussion and the adviser minute to voting. For each named member, choose a response and confirm. Verify that selection alone does not advance the member or count as a ballot. After three confirmations, use the CEO control to record the result.

[The full guide](ROUNDTABLE_GUIDE.md) explains the meeting flow.

## Verification

The implementation passed 135 playtest tests, 31 existing tests and 27 Node UI checks, plus the authored demo and documentation checks. The restarted server rejected an out of turn first vote with HTTP 403 and early commitment with HTTP 409, then accepted three explicit ballots and committed the correct two to one result.

[HTTP evidence](evaluations/voting-ui.json) records that check. Browser visual review remains manual. These are the existing implementation results; this documentation update makes no new runtime or paid provider calls.
