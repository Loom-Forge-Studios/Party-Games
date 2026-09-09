# Assets

Every third-party asset used by this project (models, textures, fonts, audio,
word lists, icons — anything not authored from scratch for this repo) must be
recorded here. This repo is public: assets must be **CC0** or **original**
(created for this project). No trademarked or otherwise-restricted
third-party content.

| Asset | Path | Source | License | Notes |
| --- | --- | --- | --- | --- |
| Lacquered Cherry Wood (diffuse map, 1k) | `packages/client/public/assets/textures/table-wood-diffuse.jpg` | [Poly Haven](https://polyhaven.com/a/lacquered_cherry_wood) | CC0 | Author: Jenelle van Heerden. Diffuse/color map only (no normal/roughness maps) applied to the table cylinder — see `packages/client/src/table/scene.ts`'s `createTable()`. |

## Visual rework (overseer, post-v1) status

Real CC0 table texture landed (row above). Sourcing real 3D models (avatar,
checkers pieces, cards) is still in progress — Poly Pizza and Kenney.nl both
gate their actual file downloads behind a Cloudflare Turnstile bot-check that
automation can't and shouldn't complete, so those specific files are being
hand-downloaded and handed off for integration rather than fetched directly.
Poly Haven's texture API (`dl.polyhaven.org`) has no such gate and was used
directly for the table texture above.

## Wave 1 (A7) status

`@party/assets` shipped zero binary asset files this wave. Every v1
placeholder — checkers discs, the full 52-card deck (canvas-drawn rank/suit
text, no scanned or photographed card art), dice, meeple-ish avatar bodies,
and wood/felt table materials — was generated in code at runtime
(`packages/assets/src/procedural/`), so there was nothing to license and
nothing fetched over the network. That satisfied this wave's DoD (every v1
game can render with zero network-fetched assets) on its own.