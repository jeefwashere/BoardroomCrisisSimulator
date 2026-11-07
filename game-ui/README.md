# Game UI: in game screens and 3D boardroom

React, Vite and TypeScript, matching Jeff's `website` branch, with three.js for the room. This app covers the game after the lobby: briefing, reading, speaking turns, the 60 second vote, the CEO tie decision, outcomes and the debrief. Jeff's pre game pages (landing, Host, Join, lobby) are not part of it.

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
| `players` | `10` | Seats filled, from 3 to 30; only the first 10 are drawn in 3D |
| `speed` | `1` | Timer speed multiplier |
| `name` | `Arjun` | Your display name |
| `ceo` | `1` | `0` makes a bot the CEO, so you see the waiting view during a tie |
| `profile` | `standard_18` | Or `fast_15` |

**Backend.** `?room=<room_id>&api=http://127.0.0.1:8000` polls `GET /api/rooms/{id}` every two seconds with the browser's cookie, as described in `docs/room-api.md`. The backend serves the briefing only today, so the vote, tie and turn actions report that they are not available yet. To try it, start the backend with `BOARDROOM_ALLOWED_ORIGINS=http://127.0.0.1:5174`, register the browser through the room API, then open the URL.

## Snapshot contract

`src/game/types.ts` describes the client view of a room. Fields from `docs/room-api.md` and `docs/start-api.md` are served by the backend. The gameplay fields inside `game` (`node`, `speaker`, `speaker_order`, `ballots_cast`, `my_ballot`, `tie`, `last_result`, `history`, `ending_label`) are a **proposal for I01**, used only by the mock until the backend serves them. Ballots stay private until voting closes, and the client never receives authored outcomes ahead of time; only the mock reads them locally.

## 3D assets

1. `public/models/characters/` holds characters 01 to 10, exported by `tools/export_characters.py` from the Mixamo rigged FBX files in `assets/characters/mixamo_rigged/`. Each is about 0.8 MB with a 1024 px texture. `animations.glb` holds the shared clips `sit`, `talk`, `disbelief` and `typing`, retargeted from the Mixamo animation files. Hips translation is converted from the animation rig's centimetre scale and proportions.
2. `public/models/props/` holds eight boardroom props generated from Nano Banana 2.1 reference images with TRELLIS.2 on Velocity job 20031, then scaled, decimated and given 1024 px JPEG textures in Blender. `props.json` lists sizes, triangle counts and source images (kept locally in `assets/props/images/`). The room uses the table, chairs, laptops, credenza, plants, speakerphone and clock. The wall display model is not used because the live canvas screen shows the phase and timer. Without the props folder the room falls back to simple placeholder furniture.

Re export the characters after changing a rig:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python game-ui/tools/export_characters.py -- \
  assets/characters/mixamo_rigged game-ui/public/models/characters 01 02 03 04 05 06 07 08 09 10
```

## Behaviour in the room

1. Seats are 0.27 m from the table edge so the characters' arms reach the tabletop.
2. Two bone arm IK keeps both hands resting flat on the table beside the laptop, with relaxed fingers, in every mood. The body plays the full clip, but only 15 percent of the clip's hand movement is kept (`GESTURE_SCALE` in `src/scene/Boardroom.ts`) so the hands stay calm.
3. The active speaker plays the talking clip and everyone else turns their head toward them. During the vote everyone types. A net negative outcome triggers the disbelief reaction.
4. The wall display shows the current decision and countdown.
5. Name tags (`src/scene/SeatTags.ts`) are laid out in screen space each frame: anchored above each head, scaled by distance, and pushed apart so they never overlap, with a stem back to the character. They use role colours shared with the player list. The speaker's tag fills with their colour and shows a sound wave, and a glowing ring in that colour marks their seat. Hovering a player in the list highlights their tag and seat. Your own character has no tag because it sits in front of the camera, and a check mark appears on your own seat only, because other ballots are private.

## Known limits

1. Only 10 characters are rigged, so seats 11 to 30 are not drawn.
2. Free text custom proposals (scenario `custom_action_policy`) and AI feedback have no screens yet.
3. There is no lip sync or facial animation; the faces are not rigged.
4. Arm and hand motion is intentionally minimal for now; there are no expressive gestures or hand collision.
5. Checks so far were in desktop Chromium (Playwright) at 1440 by 880; mobile layouts are only roughly handled.
