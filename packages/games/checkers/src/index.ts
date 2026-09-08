// Owned by A8 (Wave 2). Registers the real Checkers rules module into
// @party/engine's shared registry, overwriting the trivial stub — see
// packages/engine/src/registry.ts's header comment for why this is a
// deliberate conflict-avoidance pattern (this file is the only thing A8
// touches in a shared namespace, and it does so via registerGame(), never
// by editing registry.ts directly).
//
// Rules live in module.ts (must not import Three.js or @party/client — see
// docs/ARCHITECTURE.md §7's rules/presenter split) and route all
// randomness through the injected Rng (there happens to be none needed for
// Checkers — see module.ts's header comment).
//
// Deliberately NOT re-exported from here: presenter.ts. Whatever
// eventually imports this file for its registerGame() side effect (a
// server-side game registry bootstrap, per §7 "must be registered/
// reachable") must be able to do so in plain Node without pulling in
// Three.js or @party/client — see this package's package.json "exports"
// map, which exposes the presenter as a separate "./presenter" subpath
// for the client bundle to import instead.

import { registerGame } from '@party/engine';
import { checkersModule } from './module.js';

registerGame('checkers', checkersModule);

export default checkersModule;

export {
  checkersModule,
  DEFAULT_FORCED_CAPTURE,
  DEFAULT_DRAW_PLY_LIMIT,
  CROWNED_HOLD_MS,
  GAME_OVER_HOLD_MS,
  type CheckersOptions,
  type CheckersState,
  type CheckersAction,
  type CheckersMoveAction,
  type CheckersView,
  type CheckersPieceView,
} from './module.js';
