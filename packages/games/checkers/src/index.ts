// STUB ONLY — owned by A8 (Wave 2).
//
// Real Checkers rules (setup/reduce/view/currentActors/isTerminal/
// defaultAction) go here. This file's only job for A0 is to compile and
// demonstrate the intended pattern: a game package registers itself into
// @party/engine's shared registry via registerGame(), overwriting the
// engine's built-in trivial stub for this id — so A8 never has to touch
// packages/engine/src/registry.ts directly.
//
// Rule modules must not import Three.js (see docs/ARCHITECTURE.md
// "rules/presenter split") and must route all randomness through the
// injected Rng (ctx.rng in SetupCtx/ReduceCtx) — never Math.random().

import { registerGame, IllegalAction, type GameModule } from '@party/engine';

interface CheckersState {
  // Real board representation lands in Wave 2.
}

type CheckersAction = unknown;
type CheckersView = Record<string, never>;

const checkersModule: GameModule<CheckersState, CheckersAction, CheckersView> = {
  meta: {
    id: 'checkers',
    title: 'Checkers',
    minPlayers: 2,
    maxPlayers: 2,
    estMinutes: 15,
    summary: 'Classic diagonal-move capture game on an 8x8 board. Rules not implemented yet.',
  },
  setup: () => ({}),
  reduce: () => {
    throw new IllegalAction('checkers: no rules implemented yet');
  },
  view: () => ({}),
  currentActors: () => [],
  isTerminal: () => null,
  defaultAction: () => {
    throw new IllegalAction('checkers: no default action implemented yet');
  },
};

registerGame('checkers', checkersModule);

export default checkersModule;
