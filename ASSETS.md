# Assets

Every third-party asset used by this project (models, textures, fonts, audio,
word lists, icons — anything not authored from scratch for this repo) must be
recorded here. This repo is public: assets must be **CC0** or **original**
(created for this project). No trademarked or otherwise-restricted
third-party content.

| Asset | Path | Source | License | Notes |
| --- | --- | --- | --- | --- |
| Lacquered Cherry Wood (diffuse map, 1k) | `packages/client/public/assets/textures/table-wood-diffuse.jpg` | [Poly Haven](https://polyhaven.com/a/lacquered_cherry_wood) | CC0 | Author: Jenelle van Heerden. Diffuse/color map only (no normal/roughness maps) applied to the table cylinder — see `packages/client/src/table/scene.ts`'s `createTable()`. |
| Playing Cards Pack (52 card faces + back, "large"/64px PNGs) | `packages/client/public/assets/cards/card_<suit>_<rank>.png`, `card_back.png` | [Kenney](https://kenney.nl/assets/playing-cards-pack) | CC0 | Author: Kenney (kenney.nl). Replaces the canvas-drawn Hold'em card faces/back — see `packages/assets/src/procedural/cards.ts`'s `buildKenneyCard()`. The canvas-drawn version is kept as the headless-test fallback (`buildDrawnCard()`, used when `document` is unavailable). |
| Boardgame Pack chip face (`chipWhite_border`, 68px PNG) | `packages/client/public/assets/chips/chip_top.png` | [Kenney](https://kenney.nl/assets/boardgame-pack) | CC0 | Author: Kenney (kenney.nl). Replaces the flat-colour poker-chip cylinder top face — see `packages/games/holdem/src/presenter.ts`'s `buildChipMaterials()`. One neutral (white/grey) chip graphic is reused for both bet and stack chips, tinted via `MeshStandardMaterial.color` (multiplies with the map) so the existing gold-accent/dark-red colour coding is preserved; the cylinder's edge (and unseen bottom cap) stay flat-coloured, and the whole texture falls back to the pre-existing flat colour when no canvas/DOM is available (`canvasAvailable()`, same pattern as `cards.ts`). |

## Visual rework (overseer, post-v1) status

Real CC0 table texture, real card faces, and a real poker-chip face texture
landed (rows above). Still open: a real 3D avatar model (to replace
avatar.ts's capsule) and real checkers piece models. Poly Pizza and
Kenney.nl both gate their actual *file* downloads behind a Cloudflare
Turnstile bot-check that automation can't and shouldn't complete — Poly
Haven's texture API (`dl.polyhaven.org`) has no such gate and was used
directly for the table texture; the Kenney card pack and chip graphic above
were hand-downloaded by the user and handed off for integration. An
OpenGameArt "Playing Card Assets (52-cards deck + Chips)" pack by mehrasaur
(CC0, verified via https://opengameart.org/content/playing-card-assets-52-cards-deck-chips,
no license file was bundled with the local download so the site itself was
checked) was also considered for the chip face — its `chip_<color>_top*.png`
art is a fine, equally-valid CC0 alternative, but Kenney's bordered/ringed
chip graphic was judged to read slightly more clearly as a casino chip at
the small on-screen size these chips render at, and keeps the sourcing
consistent with the card pack above.

**Explicitly rejected, do not use:** a cburnett chess/checkers piece set was
also sourced during this pass but is **CC BY-SA 3.0 / GFDL, not CC0** —
this repo is public and CC0/original-only, so it was left out. Don't
reintroduce it (or anything else from that set) without a real license
change.

**Checkers disc (this pass):** no external asset landed. Two already-vetted
CC0 folders were checked for a top-face decal texture —
`kenney/boardgame-pack`'s `PNG/Chips/*` (license.txt confirms CC0) render as
scalloped-edge casino poker chips, not checkers pieces, and its
`PNG/Pieces (*)/` folders are pawn/meeple silhouettes, not discs — neither
reads as "checkers piece" if applied to this board; a nearby
`opengameart/poker-chips-only-2d` folder had no license file present to
verify at all, so per this repo's CC0-or-original rule it wasn't used
either. Went with a code-only geometry upgrade instead (per this
project's existing preference for that over a mediocre external asset):
`buildCheckersDisc()` in `packages/assets/src/procedural/checkers.ts` now
builds a chamfered-edge disc (three stacked cylinder sections instead of
one flat one) plus a shallow decorative ring stamped into the top face (a
small `THREE.TorusGeometry`, the same primitive `checkers/src/presenter.ts`'s
`buildKingMarker()` already uses for the crown indicator). `DISC_RADIUS`/
`DISC_HEIGHT` are unchanged, so this stays a drop-in visual upgrade with no
scale/layout impact. The procedural disc stays the piece until a genuinely
CC0 3D piece model turns up.

## Wave 1 (A7) status

`@party/assets` shipped zero binary asset files this wave. Every v1
placeholder — checkers discs, the full 52-card deck (canvas-drawn rank/suit
text, no scanned or photographed card art), dice, meeple-ish avatar bodies,
and wood/felt table materials — was generated in code at runtime
(`packages/assets/src/procedural/`), so there was nothing to license and
nothing fetched over the network. That satisfied this wave's DoD (every v1
game can render with zero network-fetched assets) on its own.