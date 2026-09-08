export type { Rng } from './rng.js';
export { Mulberry32Rng, createRng } from './rng.js';

export { IllegalAction } from './errors.js';

export type { GameMeta, SetupCtx, ReduceCtx, ReduceResult, GameModule } from './types.js';

export { registerGame, getGame, listGames, allGameIds } from './registry.js';

// GameEvent/FocusHint/FocusTarget/GameResult are canonically defined in
// @party/protocol (ServerMessage needs them, and protocol must stay
// dependency-free — see that package's events.ts and docs/ARCHITECTURE.md).
// Re-exported here so game-module authors can get everything from one
// import: `import { GameModule, GameEvent } from '@party/engine'`.
export type { GameEvent, FocusHint, FocusTarget, GameResult } from '@party/protocol';
