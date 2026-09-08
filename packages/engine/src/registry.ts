import type { GameId } from '@party/protocol';
import type { GameMeta, GameModule } from './types.js';
import { IllegalAction } from './errors.js';

/**
 * Trivial no-op GameModule used to pre-populate the registry for a game id
 * that hasn't been implemented yet. A later wave's game package calls
 * registerGame(id, realModule) from its own entry file to overwrite this —
 * a deliberate conflict-avoidance measure so each game agent only ever
 * touches its own package, never this shared registry file.
 */
function stubModule(id: GameId, title: string): GameModule<Record<string, never>, unknown, Record<string, never>> {
  return {
    meta: {
      id,
      title,
      minPlayers: 2,
      maxPlayers: 8,
      summary: `${title} — rules not implemented yet.`,
    },
    setup: () => ({}),
    reduce: () => {
      throw new IllegalAction(`${id}: no rules implemented yet`);
    },
    view: () => ({}),
    currentActors: () => [],
    isTerminal: () => null,
    defaultAction: () => {
      throw new IllegalAction(`${id}: no default action implemented yet`);
    },
  };
}

const registry = new Map<GameId, GameModule<any, any, any>>([
  ['checkers', stubModule('checkers', 'Checkers')],
  ['holdem', stubModule('holdem', "Hold'em Poker")],
  ['codewords', stubModule('codewords', 'Codewords')],
]);

/** Registers a game module, overwriting any existing entry for the same id. */
export function registerGame(id: GameId, module: GameModule<any, any, any>): void {
  registry.set(id, module);
}

/** Looks up a game module by id. */
export function getGame(id: GameId): GameModule<any, any, any> | undefined {
  return registry.get(id);
}

/** All registered game ids, e.g. for iterating the catalogue. */
export function allGameIds(): GameId[] {
  return Array.from(registry.keys());
}

/** All registered games' metadata — what the lobby's client renders as the game picker. */
export function listGames(): GameMeta[] {
  return Array.from(registry.values()).map((module) => module.meta);
}
