// Hidden-info leak guard — runs against every registered game, present and
// future (see this package's own header note in docs/ARCHITECTURE.md §7:
// "view(state, viewer) must strip everything the viewer isn't entitled to
// see... checked later by an automated leak test"). This is that test.
//
// WHAT IT DOES: drives N seeded random-but-legal games (see ./playout.ts)
// and, at every intermediate state, asserts that JSON.stringify(view(state,
// viewerId)) contains no substring belonging to information viewerId is not
// entitled to see — another player's hole cards, an unrevealed tile's true
// colour, an assassin location, etc.
//
// ---------------------------------------------------------------------------
// DECLARING A GAME'S SECRETS — read this before writing game #4 through #80
// ---------------------------------------------------------------------------
// GameModule (packages/engine/src/types.ts) is a frozen contract and this
// guard cannot add a field to it. Instead, a game module MAY optionally
// export an extra, same-named function alongside the module object it
// passes to registerGame() (as a plain additional property on that object,
// or as a named export sitting next to it — this guard finds it either way
// via a structural/duck-typed lookup, never a static type dependency):
//
//   secretFieldsFor(state: S, viewerId: PlayerId): unknown[]
//
// Return every concrete secret *value* `state` currently holds that
// `viewerId` specifically is not entitled to see — e.g. for Hold'em, every
// OTHER seated player's hole card objects; for Codewords, every unrevealed
// tile's true TileColor (and the assassin tile in particular) when viewerId
// is not that team's spymaster. When declared, this guard checks each
// returned value directly: JSON.stringify(value) must not appear anywhere
// inside JSON.stringify(view(state, viewerId)). This is the precise,
// cheap, and unambiguous mechanism — reach for it whenever you can.
//
// FALLBACK — used automatically when a game declares no secretFieldsFor
// (true of all three real v1 games; this guard cannot retrofit them, since
// packages/games/* is not this package's to edit): this guard instead
// *derives* candidate secrets structurally, by diffing one player's view
// against another's for the same state (see deriveSecretCandidates below).
// Wherever the two views disagree on a *compound* (object/array) value —
// a hole card, a tile object carrying a `color` field — the differing
// side's value becomes a candidate secret, checked against every OTHER
// viewer's serialized view exactly as an explicit declaration would be.
//
// Deliberately NOT derived this way: bare primitive/string/boolean/number
// leaf differences (e.g. a `you.role` field, a `you.team` number, a
// player's own id appearing under `you.id`). These are excluded on purpose,
// not as an oversight — a short enum-like value (a boolean, a small
// integer, a role label two different players can legitimately share) is
// far too likely to coincidentally recur elsewhere in another viewer's
// perfectly legitimate, public JSON, which would make this guard cry wolf
// on real games. A compound value (an object or array) is specific enough
// that an exact-substring match is actually meaningful signal.
//
// FAIL LOUDLY, NEVER SILENTLY PASS: if two players' views of the same state
// genuinely differ (proving the game has viewer-dependent, i.e. hidden,
// state) but this guard cannot derive even one usable (compound) secret
// candidate from that difference, and the module declares no
// secretFieldsFor — e.g. a game whose only hidden field is a bare string —
// this guard throws rather than quietly reporting "no leaks found". A
// silent pass here would be worse than no guard at all: it would look
// green while genuinely unable to check anything. See
// hidden-info-leak.test.ts's "cannot verify" fixture for this in action.
//
// A SECRET STOPS BEING A SECRET ONCE IT'S LEGITIMATELY REVEALED: some games
// (Hold'em's showdown; likely others among the next ~77) deliberately make
// previously-hidden info public to the whole table at some point, through a
// field that's independent of the one that was always viewer-specific (a
// player's `you.holeCards` always shows their own hand, win or lose — the
// showdown reveal is a *separate*, `lastShowdown` field, broadcast
// identically to everyone once a hand ends). A naive diff would flag that
// as a leak. This guard's fallback path only ever raises an alarm when a
// derived candidate shows up in ONE other player's view without showing up,
// identically, in every *other* seated player's view too — a real showdown
// broadcasts to the whole table, not to one specific opponent. This
// exception only has teeth with three or more seated players; with exactly
// two, "every other player" is the one viewer being checked, so it never
// applies (see hidden-info-leak.test.ts's real Hold'em fixture, run with 3
// seats specifically so this distinction has something to bite on).
import type { PlayerId, PlayerPublic } from '@party/protocol';
import type { GameModule } from '../types.js';
import type { Rng } from '../rng.js';
import { runRandomLegalPlayout } from './playout.js';

type SecretFieldsHook<S> = (state: S, viewerId: PlayerId) => unknown[];

function secretFieldsHookOf<S>(module: GameModule<S, unknown, unknown>): SecretFieldsHook<S> | undefined {
  const candidate = (module as unknown as { secretFieldsFor?: unknown }).secretFieldsFor;
  return typeof candidate === 'function' ? (candidate as SecretFieldsHook<S>) : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Recursively finds values present in `ownerView` that structurally differ
 * from `otherView` at the same JSON path, restricted to compound
 * (object/array) values — see this file's header for why bare primitive
 * leaves are deliberately excluded. Descends through plain (non-array)
 * objects key by key looking for nested compound diffs; within arrays,
 * compares element-by-element but never *inside* a differing element — the
 * whole differing element (e.g. one Hold'em hole card `{rank, suit}`, one
 * Codewords tile carrying `color`) becomes a single candidate, checked as
 * one specific, hard-to-collide JSON fragment rather than decomposed into
 * a lone suit letter or a bare colour string.
 *
 * Fallback rule for a *nested* (depth > 0) object whose every differing
 * key turned out to be a bare primitive (so recursing found nothing to
 * push): push the whole nested object itself, rather than silently finding
 * no candidate at all — a secret modeled as e.g. `{token, nonce}` with no
 * further nested structure is still a perfectly meaningful compound value.
 * This fallback deliberately does NOT apply at depth 0 (comparing the two
 * top-level view() results directly): a game whose *entire* view is one
 * flat object of bare-primitive fields (no wrapping container at all)
 * hasn't given this guard anything specific enough to derive — that case
 * is exactly the "fail loudly, cannot verify" path this file's header
 * documents, and it must stay reachable rather than always being papered
 * over by "well, push the whole view then".
 */
export function deriveSecretCandidates(ownerView: unknown, otherView: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();

  function push(value: unknown): void {
    if (value === undefined || value === null) return;
    const json = stableStringify(value);
    if (seen.has(json)) return;
    seen.add(json);
    out.push(value);
  }

  /** Returns true if at least one candidate was pushed for this subtree. */
  function visit(owner: unknown, other: unknown, depth: number): boolean {
    if (stableStringify(owner) === stableStringify(other)) return false;

    if (isPlainObject(owner) && isPlainObject(other)) {
      const keys = new Set([...Object.keys(owner), ...Object.keys(other)]);
      let pushedAny = false;
      for (const key of keys) {
        if (visit(owner[key], other[key], depth + 1)) pushedAny = true;
      }
      if (!pushedAny && depth > 0) {
        // See doc comment above: every differing sub-field here was a bare
        // primitive, but this nested object is itself a meaningful compound
        // unit — fall back to it rather than reporting nothing.
        push(owner);
        pushedAny = true;
      }
      return pushedAny;
    }

    if (Array.isArray(owner) && Array.isArray(other) && owner.length === other.length) {
      let pushedAny = false;
      for (let i = 0; i < owner.length; i++) {
        const a: unknown = owner[i];
        const b: unknown = other[i];
        if (stableStringify(a) === stableStringify(b)) continue;
        if (isPlainObject(a) || Array.isArray(a)) {
          push(a);
          pushedAny = true;
        }
        // A primitive array element differing is a bare-leaf diff — skipped, see header.
      }
      return pushedAny;
    }

    if (isPlainObject(owner) || Array.isArray(owner)) {
      push(owner);
      return true;
    }
    // Both sides are primitives (or one is undefined/null and the other a
    // primitive) at this path — intentionally ignored, see header.
    return false;
  }

  visit(ownerView, otherView, 0);
  return out;
}

export interface HiddenInfoLeakOptions<S, A> {
  module: GameModule<S, A, unknown>;
  players: PlayerPublic[];
  rng: Rng;
  candidatesFor: (state: S, actorId: PlayerId, rng: Rng) => A[];
  maxPlies?: number;
}

/** Thrown when this guard finds an actual leak (or, per the file header, when it cannot verify a game that provably has hidden state). */
export class HiddenInfoLeakError extends Error {}

function checkOneState<S>(module: GameModule<S, unknown, unknown>, state: S, playerIds: readonly PlayerId[]): void {
  const declaredSecretsFor = secretFieldsHookOf(module);
  const viewsById = new Map<PlayerId, unknown>(playerIds.map((id) => [id, module.view(state, id)]));

  for (const viewerId of playerIds) {
    const viewerJson = stableStringify(viewsById.get(viewerId));

    if (declaredSecretsFor) {
      for (const secret of declaredSecretsFor(state, viewerId)) {
        const fragment = stableStringify(secret);
        if (viewerJson.includes(fragment)) {
          throw new HiddenInfoLeakError(
            `hidden-info-leak: game "${module.meta.id}" leaked a declared secret into viewer "${viewerId}"'s view: ${fragment}`,
          );
        }
      }
      continue; // an explicit declaration is authoritative for this viewer — no need for the structural fallback too.
    }

    let sawAnyDifference = false;
    let usableCandidateCount = 0;
    for (const otherId of playerIds) {
      if (otherId === viewerId) continue;
      const otherJson = stableStringify(viewsById.get(otherId));
      if (viewerJson === otherJson) continue; // identical views for this pair — nothing to derive.
      sawAnyDifference = true;

      for (const candidate of deriveSecretCandidates(viewsById.get(otherId), viewsById.get(viewerId))) {
        usableCandidateCount++;
        const fragment = stableStringify(candidate);

        // A value visible identically to EVERY OTHER seated player (not
        // just viewerId specifically) is a legitimate, uniform reveal — the
        // real-world example this guard's own test suite hit is Hold'em's
        // public showdown: once a hand ends, every remaining player's hole
        // cards are broadcast to the whole table via `lastShowdown`, even
        // though each player's own `you.holeCards` (correctly) still only
        // ever shows their own hand. That's not a targeted leak, it's a
        // showdown — the actual game mechanic revealing the cards, not a
        // bug in view().
        //
        // This exception requires at least TWO other seated players before
        // it can apply (three players total). With exactly two players at
        // the table, "every other player" is just the one viewer being
        // checked, so "revealed to my only opponent" and "leaked to my only
        // opponent" are the same observable event — there is no third
        // party whose agreement would distinguish a genuine broadcast from
        // a leak, so the exception must never fire there (it would
        // otherwise vacuously excuse every 2-player leak). See
        // hidden-info-leak.test.ts's real Hold'em fixture, which
        // deliberately uses 3 seats so this distinction has something to
        // bite on, and its 2-player fixtures, which rely on this exception
        // never applying.
        const otherSeatedIds = playerIds.filter((id) => id !== otherId);
        const isUniformlyDisclosedToTheWholeTable =
          otherSeatedIds.length >= 2 && otherSeatedIds.every((id) => stableStringify(viewsById.get(id)).includes(fragment));
        if (isUniformlyDisclosedToTheWholeTable) continue;

        if (viewerJson.includes(fragment)) {
          throw new HiddenInfoLeakError(
            `hidden-info-leak: game "${module.meta.id}" leaked player "${otherId}"'s private data into viewer "${viewerId}"'s view: ${fragment}`,
          );
        }
      }
    }

    if (sawAnyDifference && usableCandidateCount === 0) {
      throw new HiddenInfoLeakError(
        `hidden-info-leak: game "${module.meta.id}" has viewer-dependent state (view() differs between players) but this guard could not ` +
          `derive any checkable (compound) secret value for viewer "${viewerId}", and the module declares no secretFieldsFor(). Refusing to ` +
          `silently pass — see this file's header comment ("DECLARING A GAME'S SECRETS") for the declaration convention.`,
      );
    }
  }
}

/** Runs one seeded random-but-legal playout and asserts no hidden-info leak at any intermediate state (initial state included). */
export function assertNoHiddenInfoLeaks<S, A>(options: HiddenInfoLeakOptions<S, A>): void {
  const { module, players, rng, candidatesFor, maxPlies } = options;
  const playerIds = players.map((p) => p.id);

  runRandomLegalPlayout({
    module,
    players,
    rng,
    candidatesFor,
    maxPlies,
    onState: (state) => checkOneState(module, state, playerIds),
  });
}
