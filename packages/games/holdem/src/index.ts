// Owned by A9. Registers the real Hold'em rules module (module.ts) into
// @party/engine's shared registry, overwriting the trivial stub that was
// here for Wave 1 — see packages/engine/src/registry.ts for why this file,
// not the registry, is where that overwrite happens.
//
// module.ts (rules) must never import Three.js or @party/client — only
// presenter.ts (client-side rendering) does. See docs/ARCHITECTURE.md
// §7 "rules/presenter split".

export { holdemModule } from './module.js';
export type {
  HoldemState,
  HoldemAction,
  HoldemView,
  HoldemPublicPlayerView,
  ShowdownReveal,
  PotAward,
  Street,
} from './state.js';
export type { Card, Suit } from './deck.js';
export { bestHandOf, compareHandScores, HAND_CATEGORY, type HandScore, type HandCategory } from './evaluator.js';
export { computeSidePots, computeUncalledRefund, splitPotAmount, orderSeatsFromLeftOfDealer } from './pots.js';

import { holdemModule } from './module.js';
export default holdemModule;
