# Game Boy tab

The Orchestrator's **Game Boy** tab (formerly a separate plugin). Split it beside any other tab, upload your own `.gba` ROM once, and play. The ROM and its save backups are stored per user in the Orchestrator's data folder (`gameboy/`), not per thread.

## Your ROM

You supply your own legally obtained ROM. None is included.

## Cheats

EmulatorJS's **Cheats** menu works as its tick boxes show: a cheat is on while its box is ticked and off when you untick it or delete it with ×, with no reload. A newly added cheat starts unticked, so tick it to switch it on. A code that patches the ROM is undone too: the tab writes the ROM's original bytes back.

## AI player (optional, off by default)

The tab can let an AI play: a **"<name> plays"** toggle next to the controls. While it's on, the page takes the game's own screen (EmulatorJS's screenshot, nothing else of the page) and a compact state read from the emulator's savestate, and sends both to this plugin's server. The server asks your decision API which input to press next, and the page presses it and shows **"<name>: <buttons> (<confidence>): <why>"** under the bar. One call runs at a time.

It stops, and says why, when you turn it off, press any key, touch or click the game, use a gamepad, hide the tab, hit a cap, or a call fails.

### Settings (Orchestrator settings, all empty by default)

| Setting | What it is |
|---|---|
| `aiPlayerEndpoint` | The URL the server POSTs each turn to. Empty: the player is off and the toggle hidden. |
| `aiPlayerModel` | Sent as the request's `model`. Empty: no `model` field. |
| `aiPlayerKeyFile` + `aiPlayerKeyName` | A dotenv file on the machine that holds the API key, and the key's name in it. The server reads it on each turn. |
| `aiPlayerKey` | Instead of the file: the key as a bb secret setting. |
| `aiPlayerHeaders` | Extra request headers, one `Name: value` per line, for example an opt-in header the API wants before it takes images. |
| `aiPlayerName` | The player's display name (default "AI"). |
| `aiPlayerGapSeconds`, `aiPlayerSessionCalls`, `aiPlayerDayCalls` | The caps: at least 3 s between calls, 100 calls per toggle-on, 500 per UTC day (kept on disk). |

The key stays on the server. It is never sent to the page, written to a log, or put in an error message.

### What the endpoint must accept

Each turn is one `POST` with `Authorization: Bearer <key>`, `Content-Type: application/json`, the extra headers, and this body:

```json
{
  "model": "<aiPlayerModel>",
  "state": {
    "screen": "<uuid>-screen",
    "game": { "game": "BPEE", "screen": "overworld", "map": { "group": 0, "num": 16, "name": "ROUTE 101" }, "position": { "x": 8, "y": 8 },
              "party": [{ "species": "MUDKIP", "level": 5, "hp": 20, "maxHp": 20 }], "battle": null, "textBox": false, "controlsLocked": false },
    "recent": [{ "choice": "walk up to explore", "map": "ROUTE 101", "x": 8, "y": 8, "screen": "overworld" }]
  },
  "assets": { "<uuid>-screen": { "type": "image", "format": "png", "data_base64": "<the screen, 480x320>" } },
  "questions": {
    "input": { "type": "choice", "instructions": "…", "criteria": { "read the next text": "…", "walk up to explore": "…", "other": "…" } }
  }
}
```

- The image goes in the top-level `assets` map, keyed by a reference string. The state holds that string where the image belongs.
- The screen is scaled up by whole pixels to at least 280 px a side, which is 480x320 for a GBA.
- The answer must carry `answers.input` as `{ "type": "choice", "choice": <one of the criteria keys>, "confidence": 0..1 }`. Anything else is refused.
- Each option is an intent with its buttons, mapped on the server: for example "read the next text" is A, "walk up to explore" is Up four times, and `other` presses nothing. The options cover A, B, the D-pad, Start, Select, L and R. No other key reaches the emulator. The option's name is the "why" on the page.

The compact state is read per game, keyed by the ROM's game code. Pokémon Emerald (`BPEE`) gives the map, position, party, battle (move names, PP and the foe) and whether text or a menu is up, using addresses from the public pokeemerald decomp. Any other game sends only its code and title along with the screen.

## Third-party code loaded at runtime

The tab runs the game with [EmulatorJS](https://emulatorjs.org) (GPL-3.0) and its mGBA core (MPL-2.0). Neither is vendored in this repository: the tab fetches them at runtime from the EmulatorJS CDN (https://cdn.emulatorjs.org), so playing needs network access to that host. Their licenses apply to that code.

## Development

Its tests run with the Orchestrator's (`npm test` in `orchestrator/`).

Game Boy and Game Boy Advance are trademarks of their respective owners; this project is not affiliated with or endorsed by them.
