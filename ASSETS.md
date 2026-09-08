# Assets

Every third-party asset used by this project (models, textures, fonts, audio,
word lists, icons — anything not authored from scratch for this repo) must be
recorded here. This repo is public: assets must be **CC0** or **original**
(created for this project). No trademarked or otherwise-restricted
third-party content.

| Asset | Path | Source | License | Notes |
| --- | --- | --- | --- | --- |

_(empty as of Wave 1 — see below)_

## Wave 1 (A7) status

`@party/assets` ships zero binary asset files this wave. Every v1 placeholder
— checkers discs, the full 52-card deck (canvas-drawn rank/suit text, no
scanned or photographed card art), dice, meeple-ish avatar bodies, and
wood/felt table materials — is generated in code at runtime
(`packages/assets/src/procedural/`), so there is nothing to license and
nothing fetched over the network. That satisfies this wave's DoD (every v1
game can render with zero network-fetched assets) on its own.

Sourcing real CC0 assets (Kenney.nl boardgame/playing-card packs, Quaternius
characters, Poly Pizza) was in scope if time allowed; it didn't happen this
wave. When it does, each added file gets a row above — file path, source
URL, author, license — before it's used, and stays CC0/original only.