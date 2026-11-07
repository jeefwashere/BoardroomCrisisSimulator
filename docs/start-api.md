# Frontend lobby to game handoff

This capability accepts Jeff's generated room code and the host's final role selections. It initializes the public briefing and permits later admission. It does not yet advance the briefing or execute speaking, voting, outcomes, or AI. [room-api.md](room-api.md) covers setup, cookies, polling, and registration.

## Frontend sequence

1. Each browser calls `GET /api/session` with `credentials: "include"`.
2. Jeff generates six ASCII letters or digits. The host calls `POST /api/rooms` with that `room_code`, its `display_name`, and a UUID `command_id`. Codes are trimmed and uppercased. A collision returns `409 room_code_taken`; generate another code and use a new command ID.
3. Each other browser calls `POST /api/rooms/join` with its own cookie, `room_code`, `display_name`, and command ID. The backend assigns its public `member_id`.
4. Poll the authenticated room snapshot approximately every two seconds. Collect role choices in Jeff's lobby. The backend receives those choices together when the host clicks Start, not through a separate role edit endpoint.
5. The host submits the exact registered member roster and one selected role per member. Names, client host flags, and arbitrary IDs cannot replace registered membership.
6. All browsers continue querying the same room. A successful Start returns `phase: "briefing"` and public briefing material under `game`.

This updates the earlier create contract: `room_code` is now required. Existing callers must add it. Jeff's frontend source is not changed by this backend work.

## Available scenario and roles

`GET /api/scenarios` returns admitted references, content digests, roles, and timing profiles. The current development package is `maplecart_cybersecurity`, version `2`, with profiles `standard_18` and `fast_15`. It remains a fictional draft with a recommended demo group of 3 to 6; capacity 30 is not a human timing validation.

Role IDs are `ceo`, `security`, `technology`, `finance`, `operations`, and `communications_privacy`. Exactly one member must hold `ceo`. Other perspectives may be shared so the room can hold 30 people. For small groups, a role can discuss related responsibilities from the briefing without gaining another vote. The host need not be CEO.

Version 2 updates capacity and large group timing metadata. Version 1 remains unchanged. Only version 2 is admitted by this API. The server loads and validates the package once at application construction and pins its JSON and public document bytes. The catalog and room snapshots exclude prepared consequences, evaluation rubrics, facilitator instructions, and future decision nodes.

## Start request

`POST /api/rooms/{room_id}/start`, with the host's private cookie:

```json
{
  "command_id": "20fb10ea-3ee4-482b-bb2a-01e1cad4df32",
  "room_code": "K7MPQ2",
  "scenario_id": "maplecart_cybersecurity",
  "scenario_version": 2,
  "timing_profile": "standard_18",
  "players": [
    {"member_id": "9d716cd1-a7c8-4e73-a8ac-a05634972559", "role_id": "security"},
    {"member_id": "4d9f5d4a-a9b9-412a-9bf4-dd673cabef79", "role_id": "ceo"},
    {"member_id": "bf5fc76f-fb8f-4be7-a5f0-90f4456938bc", "role_id": "finance"}
  ]
}
```

The UUIDs are illustrative; use actual member IDs returned by registration. The example deliberately gives the host a role other than CEO. Keep this body and command ID unchanged on a transport retry. Player array order is not significant. Correcting a rejected request is allowed because failures do not create successful receipts; a different accepted intent needs a new command ID.

Start validates these conditions atomically:

1. The cookie belongs to this room's host.
2. The room is in the lobby and the supplied code matches.
3. The scenario version and timing profile are admitted.
4. Every registered member appears exactly once, including inactive seats. No extra or omitted member IDs are accepted.
5. At least 3 registered members are recently active. The caller is active on a successful request; at least two other members must have room activity strictly less than 30 seconds old.
6. Each role belongs to the scenario and exactly one CEO is selected.

A failure leaves role assignments, phase, version, and receipts unchanged. A successful exact retry returns the original snapshot, even after later joins. A new Start command after success returns `409 already_started` and cannot rewrite roles.

## Briefing response

The standard room snapshot retains `room_id`, `room_code`, `room_version`, `host_member_id`, `self_member_id`, `capacity`, and `members`. After Start:

1. `phase` becomes `briefing`.
2. `game.phase_id` identifies this initialization; `game.round_number` is `1`.
3. `game.scenario` has `scenario_id`, `version`, `title`, and `content_sha256`. The digest covers scenario JSON and public document bytes, including document IDs and paths with length delimiters.
4. `game.timing_profile`, `game.briefing_seconds`, and `game.started_at` describe the selected briefing. No active deadline or automatic transition is installed in this capability.
5. `game.initial_node_id` and `game.initial_metrics` describe the initial authored state.
6. `game.public_documents` contains public `{id, text}` records for rendering. It contains no authored answer outcomes.
7. `game.eligible_member_ids` is the fixed first decision electorate.
8. Members expose `role_id`, `connected`, `eligible_from_round`, and `eligible_current_round`. These fields describe membership and future round eligibility, not permission to vote during briefing.

The response is the same for every member apart from `self_member_id`. Presence is server observed polling activity, not immediate socket connection state. Create, successful join, exact successful retries, Start, and authorized room GET refresh the caller's activity. A failed request does not. An old receipt can contain old activity flags; GET supplies current state. Activity changes do not increment `room_version`.

## Joining after Start

A new browser initializes its own cookie and sends:

```json
{
  "command_id": "827e1833-958e-49eb-a8d5-3f2a8ffde9c3",
  "room_code": "K7MPQ2",
  "display_name": "Sam",
  "role_id": "finance"
}
```

The new seat receives `eligible_from_round: 2` and `eligible_current_round: false`. It can read the current briefing immediately, while the first electorate and CEO stay unchanged. Capacity remains 30 including the host and all registered seats. A role is required for new admission after Start; `ceo` is unavailable. Lobby joins omit roles because the host submits them together on Start.

An existing browser can rejoin with its original name and omit `role_id`, keeping the same seat, role, and eligibility even when the room is full. Supplying a different role is rejected. A missing cookie cannot reclaim another member by name.

Later gameplay transitions must use `eligible_from_round` to freeze each new electorate. Those transitions and actual next round participation are not implemented yet; this unit verifies the admission metadata and unchanged first electorate.

## Domain errors

Domain errors use `{"detail":{"code":"...","message":"..."}}`. Malformed input uses FastAPI's validation detail array; both shapes are represented in OpenAPI.

1. `403 host_required`: the authenticated member is not the host.
2. `409 room_code_taken`: another room already reserved the frontend code.
3. `409 room_code_mismatch`: Start refers to another code.
4. `409 roster_changed`: refresh the snapshot and include all registered member IDs.
5. `409 not_enough_active_members`: fewer than 3 members meet polling freshness.
6. `409 already_started`: a new Start intent cannot replace an existing game.
7. `409 command_conflict`: an accepted command ID was reused with different content.
8. `409 role_locked`: rejoin attempted to change an assigned role.
9. `404 scenario_not_found`: unknown or unsupported scenario version.
10. `422 invalid_timing_profile`, `duplicate_member`, `invalid_role`, or `one_ceo_required`: fix the Start data.
11. `422 ceo_reserved`: a late newcomer attempted to replace the CEO.
12. `422 role_not_yet_allowed`: submit lobby roles on Start instead.

A join racing with Start is serialized by the room lock. If join commits first, an outdated Start roster is rejected. If Start commits first, a new join requires its own allowed role and begins eligibility in round 2.

## Verification and scope

Run the commands in [room-api.md](room-api.md). The real HTTP smoke now checks host controlled Start, replay, an independent late join, unchanged first electorate, and distinct CEO permissions. Tests cover invalid rosters and roles, minimum count, freshness cutoff, capacity, competing starts, immutable receipts, public projection, and scenario admission failures. These results do not verify a complete game or deployed frontend integration.

See [start-design.md](start-design.md) for module ownership and synthesis rationale. Request parsing follows [FastAPI's nested body model documentation](https://fastapi.tiangolo.com/tutorial/body-nested-models/). Activity uses [Python's monotonic elapsed clock](https://docs.python.org/3/library/time.html#time.monotonic).
