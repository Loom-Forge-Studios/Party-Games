import { describe, expect, it } from 'vitest';
import type { PlayerPublic } from '@party/protocol';
import { createRng, IllegalAction, type Rng } from '@party/engine';
import { holdemModule } from './module.js';
import type { HoldemState } from './state.js';

function players(ids: string[]): PlayerPublic[] {
  return ids.map((id, seat) => ({ id, username: id, seat, connected: true, isHost: seat === 0 }));
}

/** A fully controllable Rng for tests that need to rig exact card order/dealer position. */
class FakeRng implements Rng {
  private readonly fixedInt: number;
  constructor(fixedInt = 0) {
    this.fixedInt = fixedInt;
  }
  int(): number {
    return this.fixedInt;
  }
  float(): number {
    return 0;
  }
  shuffle<T>(items: T[]): T[] {
    return items.slice(); // deliberately unshuffled — deck stays in buildDeck()'s natural order
  }
}

describe('holdem determinism', () => {
  it('produces byte-identical state from the same seed and the same (self-derived) action sequence', () => {
    function autoPlay(seed: number, steps: number): HoldemState {
      const rng = createRng(seed);
      let state = holdemModule.setup({ players: players(['A', 'B']), rng });
      for (let i = 0; i < steps; i++) {
        const actors = holdemModule.currentActors(state);
        if (actors.length === 0) break;
        const actorId = actors[0];
        const view = holdemModule.view(state, actorId);
        const me = view.players.find((p) => p.id === actorId)!;
        const action = me.committedRound < view.currentBet ? ({ type: 'call' } as const) : ({ type: 'check' } as const);
        const result = holdemModule.reduce(state, action, { actor: actorId, rng });
        state = result.state;
      }
      return state;
    }

    const stateA = autoPlay(424242, 40);
    const stateB = autoPlay(424242, 40);

    expect(JSON.stringify(stateA)).toBe(JSON.stringify(stateB));
    // Sanity: the loop actually did something (didn't just return the initial setup() state).
    expect(stateA.handNumber).toBeGreaterThan(1);
  });

  it('diverges when the seed differs', () => {
    const rngA = createRng(1);
    const rngB = createRng(2);
    const stateA = holdemModule.setup({ players: players(['A', 'B']), rng: rngA });
    const stateB = holdemModule.setup({ players: players(['A', 'B']), rng: rngB });
    expect(JSON.stringify(stateA)).not.toBe(JSON.stringify(stateB));
  });
});

describe("holdem view() never leaks another player's hole cards", () => {
  it("serializes view(state, playerA) with no substring of playerB or playerC hole card values, while still carrying playerA's own", () => {
    const rng = createRng(999);
    const state = holdemModule.setup({ players: players(['A', 'B', 'C']), rng });

    const playerA = state.players.find((p) => p.id === 'A')!;
    const playerB = state.players.find((p) => p.id === 'B')!;
    const playerC = state.players.find((p) => p.id === 'C')!;
    expect(playerA.holeCards).toHaveLength(2);
    expect(playerB.holeCards).toHaveLength(2);
    expect(playerC.holeCards).toHaveLength(2);

    const viewA = holdemModule.view(state, 'A');
    const json = JSON.stringify(viewA);

    for (const card of [...playerB.holeCards, ...playerC.holeCards]) {
      expect(json.includes(JSON.stringify(card))).toBe(false);
      expect(json.includes(`"rank":${card.rank},"suit":"${card.suit}"`)).toBe(false);
    }

    // Not a vacuous pass — A's own cards are genuinely present in A's own view.
    for (const card of playerA.holeCards) {
      expect(json.includes(JSON.stringify(card))).toBe(true);
    }

    // And the public player list never carries a holeCards field at all, for anyone.
    for (const p of viewA.players) {
      expect(p).not.toHaveProperty('holeCards');
    }
  });

  it('still hides a folded player\'s cards after they fold — folded hands are mucked, not revealed', () => {
    const rng = createRng(7);
    const state = holdemModule.setup({ players: players(['A', 'B', 'C']), rng });
    const firstActor = holdemModule.currentActors(state)[0];
    const folded = state.players.find((p) => p.id === firstActor)!;
    const foldedCards = folded.holeCards.slice();

    const result = holdemModule.reduce(state, { type: 'fold' }, { actor: firstActor, rng });
    const viewer = state.players.find((p) => p.id !== firstActor)!.id;
    const json = JSON.stringify(holdemModule.view(result.state, viewer));

    for (const card of foldedCards) {
      expect(json.includes(JSON.stringify(card))).toBe(false);
    }
  });
});

describe('holdem betting rules', () => {
  it('rejects an action from anyone other than the current actor', () => {
    const rng = createRng(1);
    const state = holdemModule.setup({ players: players(['A', 'B', 'C']), rng });
    const actorId = holdemModule.currentActors(state)[0];
    const otherId = state.players.find((p) => p.id !== actorId)!.id;
    expect(() => holdemModule.reduce(state, { type: 'check' }, { actor: otherId, rng })).toThrow(IllegalAction);
  });

  it('rejects a raise smaller than the minimum raise size', () => {
    const rng = createRng(1);
    const state = holdemModule.setup({ players: players(['A', 'B', 'C']), rng });
    const actorId = holdemModule.currentActors(state)[0]; // UTG preflop, currentBet = bigBlind (10), minRaiseSize = 10
    expect(() =>
      holdemModule.reduce(state, { type: 'raise', amount: state.currentBet + 1 }, { actor: actorId, rng }),
    ).toThrow(IllegalAction);
  });

  it('rejects checking when facing a live bet', () => {
    const rng = createRng(1);
    const state = holdemModule.setup({ players: players(['A', 'B']), rng });
    const actorId = holdemModule.currentActors(state)[0]; // heads-up: dealer/SB acts first, faces the BB
    expect(() => holdemModule.reduce(state, { type: 'check' }, { actor: actorId, rng })).toThrow(IllegalAction);
  });

  it('awards the whole pot immediately when everyone else folds, with no showdown reveal', () => {
    const rng = createRng(1);
    const state = holdemModule.setup({ players: players(['A', 'B']), rng });
    const firstActor = holdemModule.currentActors(state)[0];
    const other = state.players.find((p) => p.id !== firstActor)!;
    const potBefore = state.players.reduce((sum, p) => sum + p.committedTotal, 0);

    const result = holdemModule.reduce(state, { type: 'fold' }, { actor: firstActor, rng });
    const awardEvent = result.events.find((ev) => ev.type === 'pot.awarded');
    expect(awardEvent).toBeDefined();
    expect((awardEvent!.payload as { awards: { playerId: string; amount: number }[] }).awards).toEqual([
      { playerId: other.id, seat: other.seat, amount: potBefore },
    ]);
    expect(result.events.some((ev) => ev.type === 'showdown')).toBe(false);
  });
});

describe('holdem 3-way all-in showdown (integration)', () => {
  it('runs the board out, refunds the uncalled excess, and splits into side pots correctly', () => {
    const rng = new FakeRng(0);
    let state = holdemModule.setup({ players: players(['P0', 'P1', 'P2']), rng });

    // Sanity on the rigged deal: dealer is seat 0 (FakeRng.int() => 0), so in a 3-handed hand
    // P1 posts SB, P2 posts BB, and the dealer (P0) is first to act preflop.
    expect(state.dealerSeat).toBe(0);
    expect(state.actingSeat).toBe(0);

    // Rig unequal remaining stacks so the three all-ins land at different total commitments.
    const p0 = state.players.find((p) => p.id === 'P0')!;
    const p1 = state.players.find((p) => p.id === 'P1')!;
    const p2 = state.players.find((p) => p.id === 'P2')!;
    p0.stack = 95; // will commit 95 total (short)
    p1.stack = 45; // already committed 5 as SB -> commits 50 total (shortest)
    p2.stack = 140; // already committed 10 as BB -> commits 150 total (deepest)

    let result = holdemModule.reduce(state, { type: 'allin' }, { actor: 'P0', rng });
    state = result.state;
    expect(state.actingSeat).toBe(1);

    result = holdemModule.reduce(state, { type: 'allin' }, { actor: 'P1', rng });
    state = result.state;
    expect(state.actingSeat).toBe(2);

    // This action closes the round with everyone all-in, so it cascades all the way through
    // the flop/turn/river runout and the showdown, inside this single reduce() call.
    result = holdemModule.reduce(state, { type: 'allin' }, { actor: 'P2', rng });

    const showdownEvent = result.events.find((ev) => ev.type === 'showdown');
    expect(showdownEvent).toBeDefined();
    const reveals = (showdownEvent!.payload as { reveals: { playerId: string; categoryLabel: string }[] }).reveals;
    expect(reveals).toHaveLength(3);
    expect(reveals.every((r) => r.categoryLabel === 'Flush')).toBe(true);

    const awardEvents = result.events.filter((ev) => ev.type === 'pot.awarded');
    const allAwards = awardEvents.flatMap((ev) => (ev.payload as { awards: { playerId: string; amount: number }[] }).awards);
    // P0 holds the best of the three flushes (same top four ranks, highest 5th card) and is
    // eligible for both side-pot layers, so every pot layer's winner is P0.
    expect(allAwards).toEqual([{ playerId: 'P0', seat: 0, amount: 240 }]);

    // P1 busted (won nothing, contributed their whole stack); the game continues since P0 and
    // P2 still have chips, so a NEW hand auto-started inside this same reduce() call — its
    // blinds are already posted by the time we inspect the returned state, so what's left in
    // .stack for P0/P2 is their showdown winnings minus the blind they just posted for hand 2.
    // (Chip conservation still holds — see the .stack + .committedTotal check below — the
    // "missing" 15 versus the raw pot-award numbers is sitting in this hand's committedTotal.)
    const finalP0 = result.state.players.find((p) => p.id === 'P0')!;
    const finalP1 = result.state.players.find((p) => p.id === 'P1')!;
    const finalP2 = result.state.players.find((p) => p.id === 'P2')!;
    expect(finalP1.eliminated).toBe(true);
    expect(result.state.handNumber).toBe(2);
    expect(finalP1.stack).toBe(0); // shortest stack, won nothing, busted

    // New hand: dealer rotates from seat 0 to the next surviving seat (skipping busted P1) —
    // seat 2 (P2) — and heads-up posts SB=dealer/5, BB=other/10.
    expect(result.state.dealerSeat).toBe(2);
    expect(finalP2.stack).toBe(55 - 5); // won 0 at showdown (refund already in stack), posted new SB
    expect(finalP0.stack).toBe(240 - 10); // won 240 at showdown, posted new BB

    // Chip conservation: total chips in play (stack + whatever's committed to hand 2's pot so
    // far) equals what was in play the moment this test rigged the stacks (95 + 5 + 45 + 10 + 140).
    const totalChips = result.state.players.reduce((sum, p) => sum + p.stack + p.committedTotal, 0);
    expect(totalChips).toBe(95 + 5 + 45 + 10 + 140);
  });
});

describe('holdem defaultAction', () => {
  it('folds when facing a live bet, checks otherwise', () => {
    const rng = createRng(1);
    const state = holdemModule.setup({ players: players(['A', 'B']), rng });
    const actorId = holdemModule.currentActors(state)[0];
    expect(holdemModule.defaultAction(state, actorId)).toEqual({ type: 'fold' });

    // After calling, that same player facing no further bet should default to check.
    const called = holdemModule.reduce(state, { type: 'call' }, { actor: actorId, rng }).state;
    const nextActor = holdemModule.currentActors(called)[0];
    // In heads-up, after SB calls, BB is next and faces no bet beyond their own blind.
    expect(holdemModule.defaultAction(called, nextActor)).toEqual({ type: 'check' });
  });
});
