# Game Boy tab

The Orchestrator's **Game Boy** tab (formerly a separate plugin). Split it beside any other tab, upload your own `.gba` ROM once, and play. The ROM and its save backups are stored per user in the Orchestrator's data folder (`gameboy/`), not per thread.

## Your ROM

You supply your own legally obtained ROM. None is included.

## Third-party code loaded at runtime

The tab runs the game with [EmulatorJS](https://emulatorjs.org) (GPL-3.0) and its mGBA core (MPL-2.0). Neither is vendored in this repository: the tab fetches them at runtime from the EmulatorJS CDN (https://cdn.emulatorjs.org), so playing needs network access to that host. Their licenses apply to that code.

## Development

Its tests run with the Orchestrator's (`npm test` in `orchestrator/`).

Game Boy and Game Boy Advance are trademarks of their respective owners; this project is not affiliated with or endorsed by them.
