# Start capability design

## Usage

Each interactive tab initializes its private player session and registers through create or join. Legacy cookie clients remain supported. Jeff supplies the six character room code. The host submits one request to `POST /api/rooms/{room_id}/start` with `command_id`, `room_code`, `scenario_id`, `scenario_version`, `timing_profile`, and `players`, a list of `{member_id, role_id}` values from the registered roster. The response enters briefing with pinned public scenario material. A new player subsequently joins with a non CEO role and eligibility from the following round.

## Existing ownership

`main.py` authenticates HTTP, `models.py` validates the wire contract, and `Rooms` is the sole writer of live state and receipts. Private server issued tab sessions identify interactive seats; legacy cookie sessions remain supported. Public names, codes, and member UUIDs do not authorize another player. Creation uses one registry lock; changes to an existing room use its lock. An exact successful retry returns its original snapshot, and GET returns current membership.

## Shape

The existing room aggregate gains an immutable `Lobby | Briefing` phase. Membership stores identity and monotonic activity only. Briefing owns all role assignments and eligibility, plus one immutable admitted scenario and selected timing profile. The current electorate derives from assignments eligible for round 1. Late admission adds an assignment eligible from round 2 and cannot expand that electorate.

```python
class Rooms:
    async def create(self, session, command_id, room_code, display_name):
        raise NotImplementedError

    async def start(self, session, room_id, command_id, spec):
        # Lock room, authorize host, check receipt, validate all admission rules.
        # Build complete immutable briefing before publishing one replacement.
        raise NotImplementedError

    async def join(self, session, command_id, room_code, display_name, role_id):
        # Existing seat retains identity and role; new started seat enters round 2.
        raise NotImplementedError
```

These are the design signatures. Implemented code is in `backend/app`. Domain seats and snapshots remain independent of HTTP schemas. Public projection explicitly includes briefing documents and excludes authored outcomes, future nodes, and private credentials. The scenario catalog validates its explicit local packages at startup, so Start performs no file or provider operation while holding a room lock. The content digest covers the scenario JSON and public document bytes.

Start validates the exact registered member set, at least 3 recently active members, capacity 30, allowed role IDs, exactly one CEO, the room code, and scenario and timing identity. Non CEO perspectives may be shared. Host and CEO remain distinct. Create, join, and authorized GET refresh only that player session's activity. Freshness means elapsed monotonic time strictly below 30 seconds; this is polling presence rather than immediate disconnect detection. Successful Start counts its caller as active. No failed command changes activity, roles, phase, version, or receipts.

## Synthesis decision

Two independent candidates were evaluated. Candidate A extends the existing aggregate with a discriminated immutable phase. Candidate B adds a separate immutable session and pure planning boundary. Available tools expose only OpenAI models, so both used the inherited model. A judge from another model family was unavailable; the parent compared both candidates.

Scores from 1 to 5, in order of requirement fidelity, one writer, bounded scope, immutable admission, and future extension: A scored 5, 5, 5, 5, 4; B scored 5, 5, 3, 5, 5. Choose A. Adopt B's pure validation discipline and typed immutable snapshot separation, without a separate session registry or a prepare and commit protocol. Keep one public Start operation and one role authority. Both candidates passed the design red flag review after removing duplicate role and electorate storage.

## Tradeoffs and boundaries

1. Accept short tuple replacement for up to 30 assignments to preserve immutable phase state and historical receipts.
2. Accept catalog validation at startup to keep admission free of I/O and partial scenario loading.
3. Accept one process and a polling activity window to preserve the existing memory storage boundary.
4. Start initializes briefing only. It does not advance time, run speaking or voting, apply outcomes, or call AI. Later round transitions must freeze their electorate using eligibility metadata.
5. Require the frontend code on create. A collision returns an error so Jeff can generate another code; the backend never silently changes it.

A second mutable game manager was rejected because it would split membership, admission and receipts across writers. Mutable optional started fields were rejected because they permit partially initialized rooms. Planning outside the lock was rejected because it requires a stale plan protocol without useful work to move outside the lock.

## Implementation check

Verify code collision races, permission and roster rejection, scenario admission, exact freshness cutoff, rollback, concurrent and repeated Start, shared perspectives, refresh, full capacity, and next round late admission. A local HTTP smoke must exercise Start with separate member sessions. These checks do not establish a complete playable game or deployed frontend integration.
