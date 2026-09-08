import { describe, it, expect } from 'vitest';
import { allGameIds, getGame, listGames, registerGame } from './registry.js';
import { IllegalAction } from './errors.js';

describe('game registry', () => {
  it('is pre-populated with exactly the three v1 games', () => {
    expect(new Set(allGameIds())).toEqual(new Set(['checkers', 'holdem', 'codewords']));
    expect(listGames()).toHaveLength(3);
  });

  it('stub modules throw IllegalAction on reduce/defaultAction and report no actors', () => {
    const checkers = getGame('checkers');
    expect(checkers).toBeDefined();
    expect(checkers!.currentActors({})).toEqual([]);
    expect(checkers!.isTerminal({})).toBeNull();
    expect(() => checkers!.reduce({}, {}, { actor: 'p1', rng: { int: () => 0, float: () => 0, shuffle: (x) => x } })).toThrow(
      IllegalAction,
    );
    expect(() => checkers!.defaultAction({}, 'p1')).toThrow(IllegalAction);
  });

  it('registerGame overwrites an entry in place, leaving the registry at 3 entries', () => {
    const before = allGameIds().length;
    registerGame('checkers', {
      meta: {
        id: 'checkers',
        title: 'Checkers',
        minPlayers: 2,
        maxPlayers: 2,
        summary: 'test override',
      },
      setup: () => ({}),
      reduce: (state) => ({ state, events: [] }),
      view: () => ({}),
      currentActors: () => [],
      isTerminal: () => null,
      defaultAction: () => ({}),
    });
    expect(allGameIds().length).toBe(before);
    expect(getGame('checkers')?.meta.summary).toBe('test override');
  });
});
