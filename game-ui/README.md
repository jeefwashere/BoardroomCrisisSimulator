# Game UI: in-game screens and 3D boardroom

React, Vite and TypeScript, matching Jeff's `website` branch, with three.js for the room. This app covers the game after the lobby: briefing, reading, speaking turns, the 60-second vote, the CEO tie decision, outcomes and the debrief. Jeff's pre-game pages (landing, Host, Join, lobby) are not part of it.

```sh
cd game-ui
npm install
npm run dev          # http://127.0.0.1:5174
npm run build        # type check and production build
```

## Modes

**Mock game (default).** A local simulation of the MapleCart scenario (`scenarios/cybersecurity_demo/v2`) using its timing profile, vote policy, outcomes and endings. You play one seat; bots fill the others and vote. The *Skip* and *Force tie* buttons step through phases.

| Query parameter | Default | Meaning |
| --- | --- | --- |
| `players` | `10` | Seats filled (3–30; only the first 10 are drawn in 3D) |
| `speed` | `1` | Timer speed multiplier |
| `name` | `Arjun` | Your display name |
| `ceo` | `1` | `0` makes a bot the CEO, so you see the "waiting for the CEO" tie view |
| `profile` | `standard_18` | Or `fast_15` |

**Backend.** `?room=<room_id>&api=http://127.0.0.1:8000` polls `GET /api/rooms/{id}` every two seconds with the browser's cookie, as described in `docs/room-api.md`. The backend only serves the briefing today, so the vote, tie and turn actions report that they are not available yet. To try it, start the backend with `BOARDROOM_ALLOWED_ORIGINS=http://127.0.0.1:5174`, register the browser through the room API, then open the URL.

## Snapshot contract

`src/game/types.ts` describes the client's view of a room. The fields from `docs/room-api.md` and `docs/start-api.md` are implemented by the backend. The gameplay fields inside `game` (`node`, `speaker`, `speaker_order`, `ballots_cast`, `my_ballot`, `tie`, `last_result`, `history`, `ending_label`) are a **proposal for I01**, used only by the mock until the backend serves them. Ballots stay private until voting closes, and the client never receives authored outcomes ahead of time; only the mock reads them locally.

## 3D assets

- `public/models/characters/` holds characters 01–10, exported from the Mixamo-rigged FBX files in `assets/characters/mixamo_rigged/` by `tools/export_characters.py`. Each is about 0.8 MB with a 1024 px texture. `animations.glb` holds the shared clips `sit`, `talk`, `disbelief` and `typing`, retargeted from the Mixamo animation files, with hips translation converted from the animation rig's centimetre scale.
- `public/models/props/` holds boardroom props generated from Nano Banana reference images with TRELLIS.2. `props.json` lists them. Without that folder the room uses simple placeholder furniture.

Re-export the characters after changing a rig:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python game-ui/tools/export_characters.py -- \
  assets/characters/mixamo_rigged game-ui/public/models/characters 01 02 03 04 05 06 07 08 09 10
```

## Behaviour in the room

The active speaker plays the talking clip, and everyone else turns their head toward them. During the vote everyone types. A net-negative outcome triggers a disbelief reaction. The wall display shows the current decision and the countdown. Name tags show each player's role, and "voted" appears on your own seat only, because other ballots are private.

## Known limits

- Only 10 characters are rigged, so seats 11–30 are not drawn.
- Free-text custom proposals (scenario `custom_action_policy`) and AI feedback have no screens yet.
- There's no lip sync or facial animation; the faces are not rigged.
- Checks so far were in desktop Chromium (Playwright) at 1440×880; mobile layouts are only roughly handled.
