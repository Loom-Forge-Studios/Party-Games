// Determinism guard, per this wave's brief: same seed + same action
// sequence => byte-identical state. codewords never calls Math.random()
// anywhere in module.ts/index.ts — every random choice (word draw, colour
// deck shuffle, team/spymaster assignment, starting team) flows through
// ctx.rng, so replaying the exact same seed and action sequence through
// two independent setup()/reduce() runs must produce identical states at
// every step, not just at the end.

import { describe, it, expect } from 'vitest';
import type { PlayerPublic } from '@party/protocol';
import { createRng, type Rng } from '@party/engine';
import { codewordsModule, type CodewordsState } from './module.js';

function makePlayers(n: number): PlayerPublic[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    username: `p${i}`,
    seat: i,
    connected: true,
    isHost: i === 0,
  }));
}

/** Plays a fixed, seed-agnostic scripted sequence of actions against a fresh game, returning every intermediate state. */
function playScript(seed: number, playerCount: number): CodewordsState[] {
  const players = makePlayers(playerCount);
  const rng: Rng = createRng(seed);
  const states: CodewordsState[] = [];

  let state = codewordsModule.setup({ players, rng });
  states.push(state);

  const spymaster = state.teams[state.turnTeam].spymaster;
  let step = codewordsModule.reduce(state, { type: 'clue.give', word: 'zzzblorptron', count: 9 }, { actor: spymaster, rng });
  state = step.state;
  states.push(state);

  // Reveal three of the active team's own tiles in board order (deterministic pick, not seed-dependent selection logic).
  for (let i = 0; i < 3; i++) {
    const team = state.turnTeam;
    const guesser = state.teams[team].guessers[0]!;
    const tile = state.tiles.find((t) => t.color === `team${team}` && !t.revealed)!;
    step = codewordsModule.reduce(state, { type: 'tile.guess', tileId: tile.id }, { actor: guesser, rng });
    state = step.state;
    states.push(state);
    if (state.phase === 'ended') break;
  }

  if (state.phase === 'guess') {
    const team = state.turnTeam;
    const guesser = state.teams[team].guessers[0]!;
    step = codewordsModule.reduce(state, { type: 'turn.pass' }, { actor: guesser, rng });
    state = step.state;
    states.push(state);
  }

  return states;
}

describe('determinism: same seed + same action sequence => byte-identical state', () => {
  it('reproduces an identical state trace across two independent runs, for several seeds', () => {
    for (const seed of [1, 42, 999, 123456]) {
      const a = playScript(seed, 4);
      const b = playScript(seed, 4);
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) {
        expect(JSON.stringify(a[i])).toBe(JSON.stringify(b[i]));
      }
    }
  });

  it('reproduces identically across different player counts too (4, 6, 8)', () => {
    for (const playerCount of [4, 6, 8]) {
      const a = playScript(2024, playerCount);
      const b = playScript(2024, playerCount);
      expect(JSON.stringify(a[a.length - 1])).toBe(JSON.stringify(b[b.length - 1]));
    }
  });

  it('different seeds produce different boards (sanity check the test itself isn\'t vacuous)', () => {
    const a = playScript(1, 4)[0]!;
    const b = playScript(2, 4)[0]!;
    expect(JSON.stringify(a.tiles)).not.toBe(JSON.stringify(b.tiles));
  });
});
