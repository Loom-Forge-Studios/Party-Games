import { describe, expect, it } from 'vitest';
import type { GameModule } from '../types.js';
import { assertDeterministic, DeterminismError } from './determinism.js';
import { discoverGameIdsFromDisk, loadRealGameModule } from './real-game-loader.js';
import { checkersCandidates, codewordsCandidates, holdemCandidates } from './real-game-candidates.js';
import { makePlayers } from './test-support.js';
import type { Rng } from '../rng.js';

// ---------------------------------------------------------------------------
// Positive control: a fixture with a stray Math.random() call — the exact
// bug class this guard exists to catch (see determinism.ts's own header).
// "A guard nobody has watched fail is not known to work": run it, confirm
// it fails, keep it as a permanent regression test.
// ---------------------------------------------------------------------------

interface FlakyState {
  seats: string[];
  rolls: number[];
}

const flakyFixture: GameModule<FlakyState, { type: 'roll' }, unknown> = {
  meta: { id: 'fixture-flaky', title: 'Fixture', minPlayers: 2, maxPlayers: 2, summary: 'fixture: uses Math.random(), not ctx.rng' },
  setup: (ctx) => ({ seats: ctx.players.map((p) => p.id), rolls: [] }),
  reduce: (state, _action) => {
    // THE BUG: Math.random() instead of ctx.rng — never actually reached in
    // this fixture's constructor argument list, but called here, exactly
    // the invariant docs/ARCHITECTURE.md §7 forbids in a real game module.
    const roll = Math.floor(Math.random() * 1000);
    return { state: { ...state, rolls: [...state.rolls, roll] }, events: [] };
  },
  view: (state) => state,
  currentActors: (state) => state.seats,
  isTerminal: (state) => (state.rolls.length >= 2 ? { winners: [], reason: 'done' } : null),
  defaultAction: () => ({ type: 'roll' }),
};

const rollCandidates = () => [{ type: 'roll' as const }];

describe('determinism guard — positive control (fixture that SHOULD fail)', () => {
  it('catches a stray Math.random() call as a non-deterministic replay', () => {
    expect(() =>
      assertDeterministic({
        module: flakyFixture,
        players: makePlayers(2),
        seed: 42,
        candidatesFor: rollCandidates,
        maxPlies: 3,
      }),
    ).toThrow(DeterminismError);
  });

  it('negative control: a well-behaved rng-only fixture replays identically', () => {
    interface CleanState {
      seats: string[];
      rolls: number[];
    }
    const cleanFixture: GameModule<CleanState, { type: 'roll' }, unknown> = {
      meta: { id: 'fixture-clean-determinism', title: 'Fixture', minPlayers: 2, maxPlayers: 2, summary: 'fixture: uses ctx.rng only' },
      setup: (ctx) => ({ seats: ctx.players.map((p) => p.id), rolls: [] }),
      reduce: (state, _action, ctx) => ({ state: { ...state, rolls: [...state.rolls, ctx.rng.int(1000)] }, events: [] }),
      view: (state) => state,
      currentActors: (state) => state.seats,
      isTerminal: (state) => (state.rolls.length >= 2 ? { winners: [], reason: 'done' } : null),
      defaultAction: () => ({ type: 'roll' }),
    };
    expect(() =>
      assertDeterministic({ module: cleanFixture, players: makePlayers(2), seed: 42, candidatesFor: rollCandidates, maxPlies: 3 }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Real games.
// ---------------------------------------------------------------------------

const REAL_CANDIDATE_PROVIDERS: Record<string, (state: unknown, actorId: string, rng: Rng) => unknown[]> = {
  checkers: checkersCandidates,
  holdem: holdemCandidates,
  codewords: codewordsCandidates,
};
const REAL_PLAYER_COUNT: Record<string, number> = { checkers: 2, holdem: 3, codewords: 4 };

describe('determinism guard — the three real v1 games', () => {
  const seeds = [7, 99, 12345];

  for (const id of discoverGameIdsFromDisk()) {
    const candidatesFor = REAL_CANDIDATE_PROVIDERS[id];
    if (!candidatesFor) continue;

    for (const seed of seeds) {
      it(`"${id}" replays byte-identically for seed ${seed}`, async () => {
        const module = await loadRealGameModule(id);
        expect(() =>
          assertDeterministic({
            module,
            players: makePlayers(REAL_PLAYER_COUNT[id] ?? module.meta.minPlayers),
            seed,
            candidatesFor,
          }),
        ).not.toThrow();
      });
    }
  }
});
