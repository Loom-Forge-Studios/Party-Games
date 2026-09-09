// @party/assets — placeholder asset pipeline (A7, Wave 1).
//
// `PlaceholderAssetLoader` implements the `AssetLoader` seam
// (packages/assets/src/loader.ts) entirely with code-generated primitives:
// checkers discs, a full 52-card deck with canvas-drawn faces, dice, meeple
// avatar bodies, and wood/felt table swatches — no external files, so every
// v1 game can render with zero network-fetched assets. See loader.ts for
// the recognised key scheme. Any third-party binary asset added later goes
// through ASSETS.md (CC0/original only, license recorded) — there are none
// yet.

export type { AssetLoader, PlaceholderAssetLoaderOptions } from './loader.js';
export { PlaceholderAssetLoader } from './placeholder-loader.js';

export { MEEPLE_COLORS, type MeepleColorName } from './procedural/meeple.js';
export { CARD_RANKS, type CardRank, type CardSuitCode } from './procedural/cards.js';
export type { CheckersVariant } from './procedural/checkers.js';
export type { TableMaterialKind } from './procedural/table.js';

// `buildNoiseTexture` is this package's shared deterministic-noise texture
// builder (wood grain, felt nap, ...) — exported so other packages'
// presenters (e.g. codewords' hidden-tile parchment texture) can reuse the
// same hash-based, canvas-optional approach instead of reimplementing it.
export { buildNoiseTexture, type RGB } from './procedural/canvas.js';
