// Overseer integration (not owned by any single wave — see
// docs/ARCHITECTURE.md and table-mount.ts's header comment for why).
//
// Each of the three v1 games independently defined its own local
// `GamePresenter<V>` interface while being built in parallel worktrees
// (there was no shared type to import yet at Wave 2 time). All three
// ended up structurally identical: `{ gameId, mount(ctx), renderView(view),
// playEvent(ev), unmount() }`. This file is the one place that assumes
// that structural match and gives table-mount.ts a single uniform type to
// program against, plus a dynamic loader so mounting a game doesn't pull
// all three games' Three.js code into a session that only plays one.

import type { GameId, GameEvent } from '@party/protocol';
import type { PresenterCtx } from '../table/index.js';

export interface GamePresenter<V = unknown> {
  gameId: GameId;
  mount(ctx: PresenterCtx): Promise<void>;
  renderView(view: V): void;
  playEvent(ev: GameEvent): Promise<void>;
  unmount(): void;
}

type Loader = () => Promise<GamePresenter>;

// Each game exposes its presenter differently (checkers/codewords have a
// class or factory; holdem exports a ready-made singleton) — see each
// package's own presenter.ts. This is where that inconsistency is
// absorbed, once, rather than in every call site.
const LOADERS: Record<GameId, Loader> = {
  checkers: async () => {
    const mod = await import('@party/game-checkers/presenter');
    return new mod.CheckersPresenter();
  },
  holdem: async () => {
    const mod = await import('@party/game-holdem/presenter');
    return mod.holdemPresenter;
  },
  codewords: async () => {
    const mod = await import('@party/game-codewords/presenter');
    return mod.createCodewordsPresenter();
  },
};

export async function loadGamePresenter(gameId: GameId): Promise<GamePresenter> {
  const loader = LOADERS[gameId];
  if (!loader) throw new Error(`no presenter registered for game '${gameId}'`);
  return loader();
}
