// Texas Hold'em GameModule: betting rounds (preflop/flop/turn/river),
// blinds + dealer rotation, side pots, 7-card hand evaluation, and a
// leak-safe view(). See evaluator.ts (hand ranking) and pots.ts (side-pot /
// split-pot math) for the pieces this file assembles into a full game.
//
// Design note on auto-advancing the game: reduce() is only ever invoked in
// response to a real player action (see packages/server/src/host/game-host.ts).
// Nothing else "ticks" the game. So every consequence of an action that
// doesn't require another human decision — closing a betting round,
// dealing the next street, running out the board when everyone left is
// all-in, resolving a showdown, starting the next hand, rotating the
// button — happens synchronously inside the same reduce() call, via the
// progress() loop below. This keeps reduce() the single place state ever
// changes (so it stays pure/deterministic given ctx.rng) while still
// leaving currentActors() always pointing at a real pending decision (or
// empty once the game is over).

import type { PlayerId } from '@party/protocol';
import { registerGame, IllegalAction, type GameModule, type SetupCtx, type ReduceCtx, type Rng, type GameEvent } from '@party/engine';
import { buildDeck, type Card } from './deck.js';
import { bestHandOf, compareHandScores, type HandScore } from './evaluator.js';
import { computeSidePots, computeUncalledRefund, orderSeatsFromLeftOfDealer, splitPotAmount, type Contribution } from './pots.js';
import type { HoldemAction, HoldemPlayerState, HoldemState, HoldemView, HoldemPublicPlayerView, PotAward, ShowdownReveal } from './state.js';

const DEFAULT_STARTING_STACK = 1000;
const DEFAULT_SMALL_BLIND = 5;
const DEFAULT_BIG_BLIND = 10;

interface HoldemOptions {
  startingStack?: number;
  smallBlind?: number;
  bigBlind?: number;
}

function resolveOptions(options: unknown): { startingStack: number; smallBlind: number; bigBlind: number } {
  const o: HoldemOptions = options && typeof options === 'object' ? (options as HoldemOptions) : {};
  const bigBlind = Number.isInteger(o.bigBlind) && (o.bigBlind as number) > 0 ? (o.bigBlind as number) : DEFAULT_BIG_BLIND;
  const smallBlind =
    Number.isInteger(o.smallBlind) && (o.smallBlind as number) > 0 && (o.smallBlind as number) < bigBlind
      ? (o.smallBlind as number)
      : Math.max(1, Math.floor(bigBlind / 2));
  const startingStack =
    Number.isInteger(o.startingStack) && (o.startingStack as number) >= bigBlind * 2 ? (o.startingStack as number) : DEFAULT_STARTING_STACK;
  return { startingStack, smallBlind, bigBlind };
}

// ---------------------------------------------------------------------------
// Small lookups

function playerBySeat(state: HoldemState, seat: number): HoldemPlayerState | undefined {
  return state.players.find((p) => p.seat === seat);
}

function playerById(state: HoldemState, id: PlayerId): HoldemPlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

function requirePositiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new IllegalAction(`holdem: ${label} must be a positive integer`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Betting-round bookkeeping

function needsAction(p: HoldemPlayerState, state: HoldemState): boolean {
  if (!p.inHand || p.folded || p.allIn) return false;
  if (!p.hasActedThisRound) return true;
  return p.committedRound < state.currentBet;
}

/** Inclusive search starting at state.actingSeat, wrapping the whole table once. */
function findNextActor(state: HoldemState): number | null {
  const n = state.players.length;
  if (state.actingSeat === null) return null;
  for (let i = 0; i < n; i++) {
    const seat = (state.actingSeat + i) % n;
    const p = playerBySeat(state, seat);
    if (p && needsAction(p, state)) return seat;
  }
  return null;
}

/** After a bet/raise (full or short all-in), everyone else still in the hand must act again. */
function reopenActionForOthers(state: HoldemState, actingSeat: number): void {
  for (const p of state.players) {
    if (p.seat === actingSeat) continue;
    if (p.inHand && !p.folded && !p.allIn) p.hasActedThisRound = false;
  }
}

function betPlacedEvent(player: HoldemPlayerState, kind: string, amount: number): GameEvent {
  return {
    type: 'bet.placed',
    payload: {
      seat: player.seat,
      kind,
      amount,
      committedRound: player.committedRound,
      committedTotal: player.committedTotal,
      stack: player.stack,
    },
    focus: { target: { kind: 'seat', seat: player.seat }, holdMs: kind === 'fold' ? 500 : 700, priority: 'normal' },
    actor: player.id,
  };
}

// ---------------------------------------------------------------------------
// Player actions — each mutates the (already-cloned) working state directly.

function applyFold(player: HoldemPlayerState, events: GameEvent[]): void {
  player.folded = true;
  player.hasActedThisRound = true;
  events.push(betPlacedEvent(player, 'fold', 0));
}

function applyCheck(state: HoldemState, player: HoldemPlayerState, events: GameEvent[]): void {
  if (player.committedRound !== state.currentBet) {
    throw new IllegalAction('holdem: cannot check facing a bet — call, raise, or fold');
  }
  player.hasActedThisRound = true;
  events.push(betPlacedEvent(player, 'check', 0));
}

function applyCall(state: HoldemState, player: HoldemPlayerState, events: GameEvent[]): void {
  const toCall = state.currentBet - player.committedRound;
  if (toCall <= 0) {
    throw new IllegalAction('holdem: nothing to call — check instead');
  }
  const commit = Math.min(toCall, player.stack);
  player.stack -= commit;
  player.committedRound += commit;
  player.committedTotal += commit;
  player.hasActedThisRound = true;
  if (player.stack === 0) player.allIn = true;
  events.push(betPlacedEvent(player, player.allIn ? 'allin' : 'call', commit));
}

function applyBet(state: HoldemState, player: HoldemPlayerState, amount: unknown, events: GameEvent[]): void {
  if (state.currentBet !== 0) {
    throw new IllegalAction('holdem: there is already a bet this round — use raise');
  }
  const requested = requirePositiveInt(amount, 'bet amount');
  const commit = Math.min(requested, player.stack);
  if (commit <= 0) throw new IllegalAction('holdem: cannot bet with an empty stack');
  const isFull = commit >= state.minRaiseSize;
  const isAllIn = commit === player.stack;
  if (!isFull && !isAllIn) {
    throw new IllegalAction(`holdem: minimum bet is ${state.minRaiseSize}`);
  }

  player.stack -= commit;
  player.committedRound += commit;
  player.committedTotal += commit;
  player.hasActedThisRound = true;
  if (player.stack === 0) player.allIn = true;

  state.currentBet = player.committedRound;
  if (isFull) state.minRaiseSize = commit;
  reopenActionForOthers(state, player.seat);

  events.push(betPlacedEvent(player, player.allIn ? 'allin' : 'bet', commit));
}

function applyRaise(state: HoldemState, player: HoldemPlayerState, amount: unknown, events: GameEvent[]): void {
  if (state.currentBet <= 0) {
    throw new IllegalAction('holdem: no bet to raise — use bet');
  }
  const totalRequested = requirePositiveInt(amount, 'raise amount');
  const desiredDelta = totalRequested - player.committedRound;
  if (desiredDelta <= 0) {
    throw new IllegalAction('holdem: raise amount must exceed your current commitment this round');
  }
  const commitDelta = Math.min(desiredDelta, player.stack);
  const newCommittedRound = player.committedRound + commitDelta;
  if (newCommittedRound <= state.currentBet) {
    throw new IllegalAction('holdem: raise must exceed the current bet — call or go all-in instead');
  }
  const increment = newCommittedRound - state.currentBet;
  const isAllIn = commitDelta === player.stack;
  const isFull = increment >= state.minRaiseSize;
  if (!isFull && !isAllIn) {
    throw new IllegalAction(`holdem: minimum raise is to ${state.currentBet + state.minRaiseSize}`);
  }

  player.stack -= commitDelta;
  player.committedRound = newCommittedRound;
  player.committedTotal += commitDelta;
  player.hasActedThisRound = true;
  if (player.stack === 0) player.allIn = true;

  state.currentBet = newCommittedRound;
  if (isFull) state.minRaiseSize = increment;
  reopenActionForOthers(state, player.seat);

  events.push(betPlacedEvent(player, player.allIn ? 'allin' : 'raise', commitDelta));
}

function applyAllIn(state: HoldemState, player: HoldemPlayerState, events: GameEvent[]): void {
  if (player.stack <= 0) {
    throw new IllegalAction('holdem: no chips left to go all-in with');
  }
  const commit = player.stack;
  const newCommittedRound = player.committedRound + commit;

  player.stack = 0;
  player.committedRound = newCommittedRound;
  player.committedTotal += commit;
  player.allIn = true;
  player.hasActedThisRound = true;

  if (newCommittedRound > state.currentBet) {
    const increment = newCommittedRound - state.currentBet;
    const isFull = increment >= state.minRaiseSize;
    state.currentBet = newCommittedRound;
    if (isFull) state.minRaiseSize = increment;
    reopenActionForOthers(state, player.seat);
  }
  // else: an all-in call for less than the current bet. currentBet is unchanged and this
  // player never needs to act again (needsAction() excludes all-in players outright) — they
  // just won't be eligible for the slice of the pot above their own contribution; see pots.ts.

  events.push(betPlacedEvent(player, 'allin', commit));
}

// ---------------------------------------------------------------------------
// Street / hand progression

function resetRoundState(state: HoldemState): void {
  state.currentBet = 0;
  state.minRaiseSize = state.bigBlindAmt;
  for (const p of state.players) {
    if (p.inHand && !p.folded) {
      p.committedRound = 0;
      p.hasActedThisRound = false;
    }
  }
  state.actingSeat = (state.dealerSeat + 1) % state.players.length;
}

function dealNextStreet(state: HoldemState, events: GameEvent[]): void {
  if (state.street === 'preflop') {
    state.deck.shift(); // burn — cosmetic, matches real-table procedure; the deck is never re-peeked
    state.community.push(...(state.deck.splice(0, 3) as Card[]));
    state.street = 'flop';
  } else if (state.street === 'flop') {
    state.deck.shift();
    state.community.push(state.deck.shift() as Card);
    state.street = 'turn';
  } else if (state.street === 'turn') {
    state.deck.shift();
    state.community.push(state.deck.shift() as Card);
    state.street = 'river';
  } else {
    throw new Error(`holdem: dealNextStreet called from invalid street "${state.street}"`);
  }

  resetRoundState(state);

  events.push({
    type: 'community.revealed',
    payload: { street: state.street, community: state.community.slice() },
    focus: { target: { kind: 'table' }, holdMs: 1400, priority: 'normal' },
  });
}

function contributionsFor(state: HoldemState): Contribution[] {
  return state.players.map((p) => ({ playerId: p.id, committed: p.committedTotal, folded: p.folded }));
}

function applyUncalledRefund(state: HoldemState, contributions: Contribution[]): void {
  const { refundPlayerId, refundAmount } = computeUncalledRefund(contributions);
  if (!refundPlayerId || refundAmount <= 0) return;
  const player = playerById(state, refundPlayerId);
  if (!player) return;
  player.stack += refundAmount;
  player.committedTotal -= refundAmount;
  const c = contributions.find((c) => c.playerId === refundPlayerId);
  if (c) c.committed -= refundAmount;
}

/**
 * Everyone else folded — award the whole pot to the last player standing, no reveal.
 *
 * Deliberately does NOT run computeUncalledRefund() here (unlike settleShowdown): that step
 * exists to find the pot-layer boundary when an all-in bet is only partially matched, which
 * only matters when there's more than one potential winner. In a fold-win the sole remaining
 * player is always at least tied for the highest total contribution (folding only ever happens
 * in response to a bet they'd have to match or beat, so nobody who folds can have contributed
 * more than the last aggressor) — so "refund the excess, then award what's left" and "award
 * the whole pot" are the same amount, and reporting the latter keeps the pot.awarded event's
 * amount matching the player's actual gain instead of splitting it across an invisible refund.
 */
function settleHandByFold(state: HoldemState, events: GameEvent[], winner: HoldemPlayerState | undefined): void {
  state.street = 'handOver';
  state.actingSeat = null;
  state.lastShowdown = null;

  if (!winner) {
    // Defensive only — can't happen: progress() only calls this when exactly one non-folded
    // in-hand player remains, and a hand never starts with fewer than two.
    state.lastAwards = null;
    return;
  }

  const potTotal = state.players.reduce((sum, p) => sum + p.committedTotal, 0);
  winner.stack += potTotal;

  state.lastAwards = [{ playerId: winner.id, seat: winner.seat, amount: potTotal }];
  events.push({
    type: 'pot.awarded',
    payload: { awards: state.lastAwards, reason: 'fold' },
    focus: { target: { kind: 'seat', seat: winner.seat }, holdMs: 3000, priority: 'high' },
    actor: winner.id,
  });
}

/** River betting closed (or the board ran out with everyone all-in) with 2+ players live — showdown. */
function settleShowdown(state: HoldemState, events: GameEvent[]): void {
  const nonFolded = state.players.filter((p) => p.inHand && !p.folded);
  const contributions = contributionsFor(state);
  applyUncalledRefund(state, contributions);

  const layers = computeSidePots(contributions);

  const scores = new Map<PlayerId, HandScore>();
  for (const p of nonFolded) {
    scores.set(p.id, bestHandOf([...p.holeCards, ...state.community]));
  }

  const awardsByPlayer = new Map<PlayerId, number>();
  for (const layer of layers) {
    let best: HandScore | null = null;
    for (const id of layer.eligiblePlayerIds) {
      const score = scores.get(id) as HandScore;
      if (!best || compareHandScores(score, best) > 0) best = score;
    }
    const winners = layer.eligiblePlayerIds.filter((id) => compareHandScores(scores.get(id) as HandScore, best as HandScore) === 0);
    const winnerSeats = winners.map((id) => (playerById(state, id) as HoldemPlayerState).seat);
    const orderedSeats = orderSeatsFromLeftOfDealer(winnerSeats, state.dealerSeat, state.players.length);
    const orderedIds = orderedSeats.map((seat) => (playerBySeat(state, seat) as HoldemPlayerState).id);
    const split = splitPotAmount(layer.amount, orderedIds);
    for (const [id, amount] of split) {
      awardsByPlayer.set(id, (awardsByPlayer.get(id) ?? 0) + amount);
    }
  }

  for (const [id, amount] of awardsByPlayer) {
    (playerById(state, id) as HoldemPlayerState).stack += amount;
  }

  state.lastShowdown = nonFolded.map(
    (p): ShowdownReveal => ({
      playerId: p.id,
      seat: p.seat,
      holeCards: p.holeCards.slice(),
      categoryLabel: (scores.get(p.id) as HandScore).label,
    }),
  );
  state.lastAwards = Array.from(awardsByPlayer.entries()).map(
    ([id, amount]): PotAward => ({ playerId: id, seat: (playerById(state, id) as HoldemPlayerState).seat, amount }),
  );

  events.push({
    type: 'showdown',
    payload: { reveals: state.lastShowdown },
    focus: { target: { kind: 'table' }, holdMs: 2200, priority: 'high' },
  });
  for (const award of state.lastAwards) {
    events.push({
      type: 'pot.awarded',
      payload: { awards: [award], reason: 'showdown' },
      focus: { target: { kind: 'seat', seat: award.seat }, holdMs: 3000, priority: 'high' },
      actor: award.playerId,
    });
  }

  state.street = 'handOver';
  state.actingSeat = null;
}

function postBlind(player: HoldemPlayerState, amount: number): void {
  const commit = Math.min(amount, player.stack);
  player.stack -= commit;
  player.committedRound = commit;
  player.committedTotal = commit;
  if (player.stack === 0) player.allIn = true;
}

/** Active (still-in-the-game) seats, ordered starting immediately left of the dealer. */
function activeSeatsFromLeftOfDealer(state: HoldemState): number[] {
  const activeSeats = state.players.filter((p) => p.inHand).map((p) => p.seat);
  return orderSeatsFromLeftOfDealer(activeSeats, state.dealerSeat, state.players.length);
}

function startHand(state: HoldemState, rng: Rng, events: GameEvent[], opts: { rotateButton: boolean }): void {
  state.handNumber += 1;
  state.lastShowdown = null;
  state.lastAwards = null;
  state.winnerPlayerId = null;
  state.community = [];

  for (const p of state.players) {
    const active = !p.eliminated;
    p.inHand = active;
    p.folded = false;
    p.allIn = false;
    p.committedRound = 0;
    p.committedTotal = 0;
    p.hasActedThisRound = false;
    p.holeCards = [];
  }

  const n = state.players.length;
  if (opts.rotateButton) {
    let seat = (state.dealerSeat + 1) % n;
    let guard = 0;
    while (!(playerBySeat(state, seat) as HoldemPlayerState).inHand) {
      seat = (seat + 1) % n;
      guard += 1;
      if (guard > n) break; // defensive: shouldn't happen, caller already ensured 2+ remain
    }
    state.dealerSeat = seat;
  }

  state.deck = rng.shuffle(buildDeck());

  const order = activeSeatsFromLeftOfDealer(state);

  for (let round = 0; round < 2; round++) {
    for (const seat of order) {
      const p = playerBySeat(state, seat) as HoldemPlayerState;
      p.holeCards.push(state.deck.shift() as Card);
    }
  }
  for (const seat of order) {
    const p = playerBySeat(state, seat) as HoldemPlayerState;
    events.push({
      type: 'card.dealt',
      payload: { seat: p.seat, cards: p.holeCards.slice() },
      focus: { target: { kind: 'seat', seat: p.seat }, holdMs: 500, priority: 'low' },
      actor: p.id,
      private: [p.id],
    });
  }

  let sbSeat: number;
  let bbSeat: number;
  if (order.length === 2) {
    // Heads-up convention: the dealer/button posts the small blind and acts first preflop.
    sbSeat = state.dealerSeat;
    bbSeat = order.find((s) => s !== sbSeat) as number;
  } else {
    sbSeat = order[0];
    bbSeat = order[1];
  }
  const sbPlayer = playerBySeat(state, sbSeat) as HoldemPlayerState;
  const bbPlayer = playerBySeat(state, bbSeat) as HoldemPlayerState;
  postBlind(sbPlayer, state.smallBlindAmt);
  postBlind(bbPlayer, state.bigBlindAmt);
  events.push(betPlacedEvent(sbPlayer, 'smallBlind', sbPlayer.committedRound));
  events.push(betPlacedEvent(bbPlayer, 'bigBlind', bbPlayer.committedRound));

  state.currentBet = bbPlayer.committedRound; // handles a short-stacked big blind posting all-in for less
  state.minRaiseSize = state.bigBlindAmt;
  state.street = 'preflop';

  if (order.length === 2) {
    state.actingSeat = sbSeat;
  } else {
    const bbIndex = order.indexOf(bbSeat);
    state.actingSeat = order[(bbIndex + 1) % order.length];
  }
}

function finishHandAndMaybeStartNext(state: HoldemState, rng: Rng, events: GameEvent[]): void {
  for (const p of state.players) {
    if (p.stack <= 0) {
      p.eliminated = true;
      p.inHand = false;
    }
  }
  const remaining = state.players.filter((p) => !p.eliminated);
  if (remaining.length <= 1) {
    state.street = 'gameOver';
    state.winnerPlayerId = remaining[0]?.id ?? null;
    state.actingSeat = null;
    return;
  }
  startHand(state, rng, events, { rotateButton: true });
}

/**
 * Runs every automatic consequence of the last player action until either a
 * real actor is waiting (return) or the game has ended (street === 'gameOver').
 * See the file header for why this cascade lives inside reduce() itself.
 */
function progress(state: HoldemState, rng: Rng, events: GameEvent[]): void {
  while (true) {
    if (state.street === 'gameOver') return;

    const nonFolded = state.players.filter((p) => p.inHand && !p.folded);
    if (nonFolded.length <= 1) {
      settleHandByFold(state, events, nonFolded[0]);
      finishHandAndMaybeStartNext(state, rng, events);
      continue;
    }

    const nextSeat = findNextActor(state);
    if (nextSeat !== null) {
      state.actingSeat = nextSeat;
      return;
    }

    if (state.street === 'river') {
      settleShowdown(state, events);
      finishHandAndMaybeStartNext(state, rng, events);
      continue;
    }

    dealNextStreet(state, events);
  }
}

// ---------------------------------------------------------------------------
// GameModule

function setup(ctx: SetupCtx): HoldemState {
  const { startingStack, smallBlind, bigBlind } = resolveOptions(ctx.options);

  const players: HoldemPlayerState[] = ctx.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((pp) => ({
      id: pp.id,
      seat: pp.seat,
      stack: startingStack,
      holeCards: [],
      folded: false,
      allIn: false,
      committedRound: 0,
      committedTotal: 0,
      hasActedThisRound: false,
      inHand: false,
      eliminated: false,
    }));

  const dealerSeat = players[ctx.rng.int(players.length)].seat;

  const state: HoldemState = {
    players,
    deck: [],
    community: [],
    street: 'preflop',
    dealerSeat,
    smallBlindAmt: smallBlind,
    bigBlindAmt: bigBlind,
    currentBet: 0,
    minRaiseSize: bigBlind,
    actingSeat: null,
    handNumber: 0,
    lastShowdown: null,
    lastAwards: null,
    winnerPlayerId: null,
  };

  // setup() has no events channel (GameModule contract) — the discarded array below just lets
  // startHand() share its implementation with the reduce()-driven path, which does use events.
  startHand(state, ctx.rng, [], { rotateButton: false });
  return state;
}

function reduce(state: HoldemState, action: HoldemAction, ctx: ReduceCtx): { state: HoldemState; events: GameEvent[] } {
  if (state.street === 'handOver' || state.street === 'gameOver') {
    throw new IllegalAction('holdem: this hand is not accepting actions right now');
  }
  const actingPlayer = playerBySeat(state, state.actingSeat ?? -1);
  if (!actingPlayer || actingPlayer.id !== ctx.actor) {
    throw new IllegalAction('holdem: it is not your turn');
  }
  if (!action || typeof action !== 'object' || typeof (action as { type?: unknown }).type !== 'string') {
    throw new IllegalAction('holdem: malformed action');
  }

  const next: HoldemState = structuredClone(state);
  const nextPlayer = playerBySeat(next, actingPlayer.seat) as HoldemPlayerState;
  const events: GameEvent[] = [];

  switch (action.type) {
    case 'fold':
      applyFold(nextPlayer, events);
      break;
    case 'check':
      applyCheck(next, nextPlayer, events);
      break;
    case 'call':
      applyCall(next, nextPlayer, events);
      break;
    case 'bet':
      applyBet(next, nextPlayer, action.amount, events);
      break;
    case 'raise':
      applyRaise(next, nextPlayer, action.amount, events);
      break;
    case 'allin':
      applyAllIn(next, nextPlayer, events);
      break;
    default:
      throw new IllegalAction(`holdem: unknown action type "${(action as { type: string }).type}"`);
  }

  progress(next, ctx.rng, events);
  return { state: next, events };
}

function view(state: HoldemState, viewer: PlayerId): HoldemView {
  const players: HoldemPublicPlayerView[] = state.players.map((p) => ({
    id: p.id,
    seat: p.seat,
    stack: p.stack,
    committedRound: p.committedRound,
    committedTotal: p.committedTotal,
    folded: p.folded,
    allIn: p.allIn,
    inHand: p.inHand,
    eliminated: p.eliminated,
    holeCardCount: p.holeCards.length,
  }));

  const me = state.players.find((p) => p.id === viewer);
  const you = me && me.holeCards.length > 0 ? { id: me.id, seat: me.seat, holeCards: me.holeCards.slice() } : null;

  const pot = state.players.reduce((sum, p) => sum + p.committedTotal, 0);

  return {
    street: state.street,
    dealerSeat: state.dealerSeat,
    smallBlindAmt: state.smallBlindAmt,
    bigBlindAmt: state.bigBlindAmt,
    community: state.community.slice(),
    pot,
    currentBet: state.currentBet,
    minRaiseSize: state.minRaiseSize,
    actingSeat: state.actingSeat,
    players,
    you,
    lastShowdown: state.lastShowdown ? state.lastShowdown.map((r) => ({ ...r, holeCards: r.holeCards.slice() })) : null,
    lastAwards: state.lastAwards ? state.lastAwards.map((a) => ({ ...a })) : null,
    handNumber: state.handNumber,
    winnerPlayerId: state.winnerPlayerId,
  };
}

function currentActors(state: HoldemState): PlayerId[] {
  if (state.street === 'handOver' || state.street === 'gameOver' || state.actingSeat === null) return [];
  const p = playerBySeat(state, state.actingSeat);
  return p ? [p.id] : [];
}

function isTerminal(state: HoldemState): { winners: PlayerId[]; scores?: Record<PlayerId, number>; reason: string } | null {
  if (state.street !== 'gameOver') return null;
  const scores: Record<PlayerId, number> = {};
  for (const p of state.players) scores[p.id] = p.stack;
  if (!state.winnerPlayerId) {
    return { winners: [], scores, reason: 'holdem: the game ended with no players remaining' };
  }
  return { winners: [state.winnerPlayerId], scores, reason: 'Last player standing wins all the chips' };
}

function defaultAction(state: HoldemState, player: PlayerId): HoldemAction {
  const p = playerById(state, player);
  if (!p) throw new IllegalAction('holdem: unknown player for defaultAction');
  if (p.committedRound < state.currentBet) return { type: 'fold' };
  return { type: 'check' };
}

export const holdemModule: GameModule<HoldemState, HoldemAction, HoldemView> = {
  meta: {
    id: 'holdem',
    title: "Hold'em Poker",
    minPlayers: 2,
    maxPlayers: 8,
    estMinutes: 30,
    summary: 'Community-card poker with betting rounds, side pots, and showdowns — play continues until one player holds every chip.',
  },
  setup,
  reduce,
  view,
  currentActors,
  isTerminal,
  defaultAction,
};

registerGame('holdem', holdemModule);
