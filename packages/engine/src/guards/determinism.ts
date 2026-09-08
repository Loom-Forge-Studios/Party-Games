// Determinism guard: same seed + same action sequence must produce
// byte-identical resulting state (JSON.stringify equality) across two
// independent setup()+reduce() runs — see docs/ARCHITECTURE.md §7 ("All
// randomness flows through an injected Rng... no Math.random() anywhere in
// a game module"). This is the automated check for that invariant: a stray
// Math.random(), Date.now(), or iteration over a Map/Set/object whose
// enumeration order isn't guaranteed would all show up here as a
// mismatched replay.
//
// Run 1 drives a real random-but-legal playout (see ./playout.ts) and
// records the *exact* sequence of actions taken — this run is itself
// allowed to make choices via the injected rng (that's what "random" means
// here). Run 2 is a completely independent setup()+reduce() sequence, using
// a freshly-constructed rng seeded identically, that replays those exact
// recorded actions (not re-derived candidates — the literal actions Run 1
// took) and asserts the state after every single reduce() call matches
// Run 1's byte-for-byte.
import type { PlayerId, PlayerPublic } from '@party/protocol';
import type { GameModule } from '../types.js';
import { createRng, type Rng } from '../rng.js';
import { pickActor, runRandomLegalPlayout } from './playout.js';

export interface DeterminismOptions<S, A> {
  module: GameModule<S, A, unknown>;
  players: PlayerPublic[];
  seed: number;
  candidatesFor: (state: S, actorId: PlayerId, rng: Rng) => A[];
  maxPlies?: number;
}

export class DeterminismError extends Error {}

function assertEqualJson(label: string, expected: unknown, actual: unknown): void {
  const expectedJson = JSON.stringify(expected);
  const actualJson = JSON.stringify(actual);
  if (expectedJson !== actualJson) {
    throw new DeterminismError(`determinism: ${label} — expected ${expectedJson}, got ${actualJson}`);
  }
}

export function assertDeterministic<S, A>(options: DeterminismOptions<S, A>): void {
  const { module, players, seed, candidatesFor, maxPlies } = options;
  const gameId = module.meta.id;

  const run1 = runRandomLegalPlayout({ module, players, rng: createRng(seed), candidatesFor, maxPlies });

  const rng2 = createRng(seed);
  let state = module.setup({ players, rng: rng2 });
  assertEqualJson(`game "${gameId}" setup() differed across two runs with the same seed ${seed}`, run1.initialState, state);

  run1.steps.forEach((step, i) => {
    // Mirror playout.ts's own rng consumption exactly before replaying the
    // recorded action: it draws once to pick the actor (pickActor, even
    // with a single candidate actor — see its own doc comment) and then
    // calls candidatesFor(), which may itself draw (e.g. to shuffle a
    // candidate list). Neither call's *result* matters here — we already
    // know the actual action taken — but skipping either call would leave
    // rng2 in a different internal state than rng1 was at the equivalent
    // reduce() call, which would make even a perfectly deterministic game
    // look like it diverged, for a reason that has nothing to do with the
    // game module itself.
    const actors = module.currentActors(state);
    const actorId = pickActor(actors, rng2);
    if (actorId !== step.actorId) {
      throw new DeterminismError(
        `determinism: game "${gameId}" diverged before ply ${i + 1} even picked the same actor to act (expected "${step.actorId}", got "${actorId}") — currentActors() itself must have returned something different this time, which points at non-determinism upstream of the replayed action.`,
      );
    }
    candidatesFor(state, actorId, rng2);

    const { state: nextState } = module.reduce(state, step.action, { actor: step.actorId, rng: rng2 });
    state = nextState;
    assertEqualJson(
      `game "${gameId}" diverged at ply ${i + 1} of ${run1.steps.length} replaying seed ${seed} and the same action sequence`,
      step.stateAfter,
      state,
    );
  });
}
