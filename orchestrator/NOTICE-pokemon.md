# Pokémon notice

Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. This project is
not affiliated with, endorsed by or sponsored by Nintendo, Creatures Inc., GAME FREAK inc. or The Pokémon Company.

The orchestrator's Pokémon feature is off by default. Turn it on with the plugin's `pokemon` setting: each agent then
gets a Pokémon that evolves as it levels, shown in the app and the sidebar, named in its brief, with evolutions on the
board. With it off, agents get neutral avatars and no Pokémon name appears anywhere.

This repository contains no Pokémon images. With the setting on, the app loads sprites at runtime from the public
[PokeAPI sprites repository](https://github.com/PokeAPI/sprites) on GitHub (`raw.githubusercontent.com`); nothing is
fetched with it off. The plugin keeps only names and National Pokédex numbers (`mons.ts`).
