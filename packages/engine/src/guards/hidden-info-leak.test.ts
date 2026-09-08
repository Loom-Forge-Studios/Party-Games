import { describe, expect, it } from 'vitest';
import type { GameModule } from '../types.js';
import { createRng } from '../rng.js';
import { assertNoHiddenInfoLeaks, deriveSecretCandidates, HiddenInfoLeakError } from './hidden-info-leak.js';
import { loadRealGameModule, discoverGameIdsFromDisk } from './real-game-loader.js';
import { checkersCandidates, codewordsCandidates, holdemCandidates } from './real-game-candidates.js';
import { makePlayers } from './test-support.js';

// ---------------------------------------------------------------------------
// Fixture games. "A guard nobody has watched fail is not known to work" —
// each of these is a small, deliberately-broken GameModule that SHOULD
// trip this guard, built inline here (never as a packages/games/* entry,
// which this package doesn't own). See hidden-info-leak.ts's own header for
// the declaration convention these fixtures exercise.
// ---------------------------------------------------------------------------

interface CompoundLeakState {
  seats: string[];
  secretByPlayer: Record<string, { token: string; nonce: number }>;
}

/** Leaks the *other* player's whole secret object under a wrongly-named field — a compound (object) leak, which the structural fallback should derive and catch with no declaration at all. */
const compoundLeakFixture: GameModule<CompoundLeakState, { type: 'noop' }, unknown> = {
  meta: { id: 'fixture-compound-leak', title: 'Fixture', minPlayers: 2, maxPlayers: 2, summary: 'fixture: leaks a compound secret' },
  setup: (ctx) => {
    const seats = ctx.players.map((p) => p.id);
    const secretByPlayer: Record<string, { token: string; nonce: number }> = {};
    for (const id of seats) secretByPlayer[id] = { token: `secret-${id}`, nonce: ctx.rng.int(1_000_000) };
    return { seats, secretByPlayer };
  },
  reduce: (state) => ({ state, events: [] }),
  view: (state, viewer) => {
    const otherId = state.seats.find((id) => id !== viewer) as string;
    return { mine: state.secretByPlayer[viewer], oopsAlsoThis: state.secretByPlayer[otherId] };
  },
  currentActors: (state) => state.seats,
  isTerminal: () => null,
  defaultAction: () => ({ type: 'noop' }),
};

interface BareSecretState {
  seats: string[];
  wordByPlayer: Record<string, string>;
}

const BARE_WORDS = ['alpha', 'bravo', 'charlie', 'delta'];

/** A per-player secret that is a bare string, not wrapped in any object/array, and correctly NOT leaked into other players' views — but with no secretFieldsFor() declared either. The guard cannot derive a checkable candidate from a bare primitive diff (see hidden-info-leak.ts's header), so it must fail loudly rather than silently concluding "no leak found" when it never actually checked anything. */
const bareSecretNoDeclarationFixture: GameModule<BareSecretState, { type: 'noop' }, unknown> = {
  meta: { id: 'fixture-bare-secret', title: 'Fixture', minPlayers: 2, maxPlayers: 2, summary: 'fixture: bare-string secret, no declaration' },
  setup: (ctx) => {
    const seats = ctx.players.map((p) => p.id);
    const shuffled = ctx.rng.shuffle(BARE_WORDS);
    const wordByPlayer: Record<string, string> = {};
    seats.forEach((id, i) => (wordByPlayer[id] = shuffled[i] as string));
    return { seats, wordByPlayer };
  },
  reduce: (state) => ({ state, events: [] }),
  view: (state, viewer) => ({ myWord: state.wordByPlayer[viewer] }), // correctly never includes anyone else's word.
  currentActors: (state) => state.seats,
  isTerminal: () => null,
  defaultAction: () => ({ type: 'noop' }),
};

/** Same shape as the fixture above, but WITH the bug (leaks every player's word) AND a declared secretFieldsFor() — proving the declaration path itself catches a real leak the structural fallback alone cannot see. */
const bareSecretDeclaredFixture: GameModule<BareSecretState, { type: 'noop' }, unknown> = {
  ...bareSecretNoDeclarationFixture,
  meta: { ...bareSecretNoDeclarationFixture.meta, id: 'fixture-bare-secret-declared' },
  view: (state, viewer) => ({ myWord: state.wordByPlayer[viewer], debugAllWords: Object.values(state.wordByPlayer) }),
};
(bareSecretDeclaredFixture as unknown as { secretFieldsFor: (state: BareSecretState, viewerId: string) => unknown[] }).secretFieldsFor = (
  state,
  viewerId,
) => state.seats.filter((id) => id !== viewerId).map((id) => state.wordByPlayer[id]);

/** A clean fixture with a genuine compound secret that is correctly stripped — a negative control, so this guard is shown not to cry wolf on well-behaved games. */
const cleanFixture: GameModule<CompoundLeakState, { type: 'noop' }, unknown> = {
  ...compoundLeakFixture,
  meta: { ...compoundLeakFixture.meta, id: 'fixture-clean' },
  view: (state, viewer) => ({ mine: state.secretByPlayer[viewer] }),
};

const trivialCandidates = () => [{ type: 'noop' as const }];

describe('hidden-info-leak guard — positive controls (fixtures that SHOULD fail)', () => {
  it('catches a compound secret leaked with no declaration, via structural diffing', () => {
    expect(() =>
      assertNoHiddenInfoLeaks({
        module: compoundLeakFixture,
        players: makePlayers(2),
        rng: createRng(1),
        candidatesFor: trivialCandidates,
        maxPlies: 1,
      }),
    ).toThrow(HiddenInfoLeakError);
    expect(() =>
      assertNoHiddenInfoLeaks({
        module: compoundLeakFixture,
        players: makePlayers(2),
        rng: createRng(1),
        candidatesFor: trivialCandidates,
        maxPlies: 1,
      }),
    ).toThrow(/leaked player .* private data/);
  });

  it('fails loudly (does not silently pass) when a game has hidden state but no derivable/declared secrets', () => {
    expect(() =>
      assertNoHiddenInfoLeaks({
        module: bareSecretNoDeclarationFixture,
        players: makePlayers(2),
        rng: createRng(1),
        candidatesFor: trivialCandidates,
        maxPlies: 1,
      }),
    ).toThrow(/could not derive any checkable/);
  });

  it('catches a leak of a declared secret that the structural fallback alone could not see', () => {
    expect(() =>
      assertNoHiddenInfoLeaks({
        module: bareSecretDeclaredFixture,
        players: makePlayers(2),
        rng: createRng(1),
        candidatesFor: trivialCandidates,
        maxPlies: 1,
      }),
    ).toThrow(/leaked a declared secret/);
  });

  it('negative control: a well-behaved compound-secret game passes cleanly', () => {
    expect(() =>
      assertNoHiddenInfoLeaks({
        module: cleanFixture,
        players: makePlayers(2),
        rng: createRng(1),
        candidatesFor: trivialCandidates,
        maxPlies: 1,
      }),
    ).not.toThrow();
  });
});

describe('deriveSecretCandidates', () => {
  it('ignores bare primitive diffs but surfaces a differing compound value', () => {
    const owner = { role: 'spymaster', team: 0, hand: [{ rank: 11, suit: 'H' }] };
    const other = { role: 'guesser', team: 1, hand: [{ rank: 4, suit: 'C' }] };
    const candidates = deriveSecretCandidates(owner, other);
    expect(candidates).toEqual([{ rank: 11, suit: 'H' }]);
  });

  it('finds nothing when views are identical', () => {
    const v = { a: 1, b: [{ x: 1 }] };
    expect(deriveSecretCandidates(v, JSON.parse(JSON.stringify(v)))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Real games — the actual point of this guard.
// ---------------------------------------------------------------------------

const REAL_CANDIDATE_PROVIDERS: Record<string, (state: unknown, actorId: string, rng: ReturnType<typeof createRng>) => unknown[]> = {
  checkers: checkersCandidates,
  holdem: holdemCandidates,
  codewords: codewordsCandidates,
};
const REAL_PLAYER_COUNT: Record<string, number> = { checkers: 2, holdem: 3, codewords: 4 };

describe('hidden-info-leak guard — the three real v1 games', () => {
  const seeds = [1, 2, 3];

  for (const id of discoverGameIdsFromDisk()) {
    const candidatesFor = REAL_CANDIDATE_PROVIDERS[id];
    if (!candidatesFor) continue; // a future game without a candidate provider here just isn't exercised by *this* test file — see README note below.

    for (const seed of seeds) {
      it(`"${id}" leaks nothing across a seeded random-but-legal game (seed ${seed})`, async () => {
        const module = await loadRealGameModule(id);
        expect(() =>
          assertNoHiddenInfoLeaks({
            module,
            players: makePlayers(REAL_PLAYER_COUNT[id] ?? module.meta.minPlayers),
            rng: createRng(seed),
            candidatesFor,
          }),
        ).not.toThrow();
      });
    }
  }
});
