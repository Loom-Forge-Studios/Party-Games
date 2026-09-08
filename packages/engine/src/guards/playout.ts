// Shared "play a seeded, random-but-legal game" driver used by the
// hidden-info-leak and determinism guards (both need to actually run a
// GameModule through a realistic sequence of turns, not just call its
// functions in isolation).
//
// A GameModule's contract gives us no generic "list every legal action"
// helper (see docs/ARCHITECTURE.md §B — GameModule only exposes
// setup/reduce/view/currentActors/isTerminal/defaultAction), and each of
// the three real v1 games has a completely different action shape, so this
// file cannot itself know what a "plausible" action looks like for a given
// game. Instead, the caller supplies a small `candidatesFor(state, actorId,
// rng)` function returning a *list* of actions worth trying for that actor
// at that state, in whatever order/randomness it likes (typically: shuffle
// a handful of game-specific candidates via the injected rng). This driver
// tries each candidate against the real `reduce()` in order, keeping the
// first one that doesn't throw IllegalAction — i.e. the first one that
// actually *is* legal right now — and falls back to the game's own
// `defaultAction()` (guaranteed legal by contract) if every candidate is
// rejected. This is why candidatesFor never needs to reimplement a game's
// legality rules itself: reduce() is the single source of truth on what's
// legal, exactly as it is for the real server.
//
// IMPORTANT correctness note: a candidate is only ever passed to reduce()
// ONCE. The winning candidate's own {state, events} result is reused
// directly rather than calling reduce() a second time "for real" — reduce()
// consumes ctx.rng, so invoking it twice for the same accepted action would
// double-advance the shared rng stream and could legitimately produce two
// different states for the exact same (state, action) pair (e.g. Hold'em's
// post-action `progress()` may shuffle a fresh deck). This is safe because
// every real game validates an action before it ever touches ctx.rng (see
// each module's reduce(): illegal input is rejected up front) — a rejected
// candidate is guaranteed not to have consumed any randomness.
import type { GameId, PlayerId, PlayerPublic } from '@party/protocol';
import type { GameModule, ReduceResult } from '../types.js';
import type { Rng } from '../rng.js';

/**
 * True if `err` is (or looks exactly like) an IllegalAction. Deliberately
 * NOT `err instanceof IllegalAction`: a real game package loaded via
 * real-game-loader.ts's dynamic import resolves "@party/engine" to its
 * built dist — a *different* loaded instance of this same package than the
 * one this file itself was compiled/transformed from (this file's own
 * '../errors.js' import resolves to source under Vitest). Two different
 * module instances mean two different IllegalAction *constructors*, so
 * `instanceof` fails even for a genuinely-thrown IllegalAction from a real
 * game's reduce() — verified directly: this was a real bug caught by this
 * guard suite's own "real games" tests failing with the underlying
 * IllegalAction escaping uncaught. `.name` is a plain string set in the
 * constructor (see errors.ts) and survives across module instances.
 */
function isIllegalActionLike(err: unknown): boolean {
  return err instanceof Error && err.name === 'IllegalAction';
}

/**
 * Picks which of `actors` acts next, consuming exactly one rng draw (even
 * when there's only one candidate — Rng.int(1) still advances the
 * generator's internal state). Exported so determinism.ts's replay can
 * reproduce this exact same draw for the exact same reason it replays
 * everything else identically: two independent runs seeded the same way
 * must consume their rng in lockstep, ply for ply, or later reduce() calls
 * that also draw from rng would silently diverge even though the same
 * *actions* were replayed — see determinism.ts's own note on this.
 */
export function pickActor(actors: readonly PlayerId[], rng: Rng): PlayerId {
  return actors[rng.int(actors.length)] as PlayerId;
}

/** One real reduce() call this driver actually took. */
export interface PlayoutStep<S, A> {
  actorId: PlayerId;
  action: A;
  stateAfter: S;
}

export interface PlayoutResult<S, A> {
  gameId: GameId;
  players: PlayerPublic[];
  initialState: S;
  steps: ReadonlyArray<PlayoutStep<S, A>>;
  finalState: S;
  /** True if isTerminal() became non-null before maxPlies was reached. */
  reachedTerminal: boolean;
}

export interface PlayoutOptions<S, A> {
  module: GameModule<S, A, unknown>;
  players: PlayerPublic[];
  rng: Rng;
  /** See file header: candidate actions to try, in the order to try them. */
  candidatesFor: (state: S, actorId: PlayerId, rng: Rng) => A[];
  /** Safety valve against a driver bug (or a genuinely non-terminating game) hanging a test forever. */
  maxPlies?: number;
  /** Invoked with the state right after setup() (ply 0) and after every accepted reduce() call. Guards use this to inspect every intermediate state, not just the final one. */
  onState?: (state: S, ply: number) => void;
}

const DEFAULT_MAX_PLIES = 400;

export function runRandomLegalPlayout<S, A>(options: PlayoutOptions<S, A>): PlayoutResult<S, A> {
  const { module, players, rng, candidatesFor, onState } = options;
  const maxPlies = options.maxPlies ?? DEFAULT_MAX_PLIES;

  const initialState = module.setup({ players, rng });
  onState?.(initialState, 0);

  let state = initialState;
  const steps: PlayoutStep<S, A>[] = [];
  let reachedTerminal = module.isTerminal(state) !== null;

  for (let ply = 0; ply < maxPlies && !reachedTerminal; ply++) {
    const actors = module.currentActors(state);
    if (actors.length === 0) {
      // Not terminal per isTerminal(), yet nobody is pending — nothing left
      // this driver can legally do. Stop rather than spin forever; callers
      // that care can inspect `reachedTerminal` (false here) themselves.
      break;
    }
    // When several players may act (e.g. Codewords' guessers), let the
    // injected rng pick among them so different seeds actually explore
    // different play order, not just different individual actions.
    const actorId = pickActor(actors, rng);

    const candidates = candidatesFor(state, actorId, rng);
    let chosen: { action: A; result: ReduceResult<S> } | undefined;
    for (const candidate of candidates) {
      try {
        const result = module.reduce(state, candidate, { actor: actorId, rng });
        chosen = { action: candidate, result };
        break;
      } catch (err) {
        if (isIllegalActionLike(err)) continue;
        throw err;
      }
    }
    if (!chosen) {
      const action = module.defaultAction(state, actorId);
      const result = module.reduce(state, action, { actor: actorId, rng });
      chosen = { action, result };
    }

    state = chosen.result.state;
    steps.push({ actorId, action: chosen.action, stateAfter: state });
    onState?.(state, ply + 1);

    if (module.isTerminal(state) !== null) reachedTerminal = true;
  }

  return {
    gameId: module.meta.id,
    players,
    initialState,
    steps,
    finalState: state,
    reachedTerminal,
  };
}
