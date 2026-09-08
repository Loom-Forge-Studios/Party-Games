// Side-pot and split-pot math, kept as pure functions over plain records so
// they're independently unit-testable without a whole HoldemState.
//
// Side pots: when players go all-in at different stack sizes, each all-in
// player can only win chips up to the amount they themselves contributed —
// anything wagered beyond that by other, deeper-stacked players forms a
// separate pot those shorter all-in players aren't eligible for. See
// computeSidePots().
//
// Odd-chip remainder rule (documented once, here, per the assignment):
// when a pot layer splits evenly among tied winners it can't divide without
// a remainder, the leftover chips go one at a time, starting from the tied
// winner seated closest to the left of the dealer button, in seat order.
// This is the traditional live-poker convention. See splitPotAmount().

import type { PlayerId } from '@party/protocol';

export interface Contribution {
  playerId: PlayerId;
  /** Total chips this player has put into the pot this hand (all streets combined). */
  committed: number;
  folded: boolean;
}

export interface PotLayer {
  amount: number;
  /** Players still eligible to win this layer (i.e. not folded, committed at least this layer's level). */
  eligiblePlayerIds: PlayerId[];
}

/**
 * If exactly one player has the single highest total contribution and no
 * other player (folded or not) matched it, that excess was never "covered"
 * by anyone and must be returned to them rather than entering any pot —
 * standard uncalled-bet-return rule. Returns the refund to apply (amount
 * 0 / playerId null when nothing is owed). Pure: callers apply the refund
 * to the player's actual stack and reduce their tracked `committed` value
 * by the same amount before calling computeSidePots().
 */
export function computeUncalledRefund(contributions: Contribution[]): {
  refundPlayerId: PlayerId | null;
  refundAmount: number;
} {
  if (contributions.length === 0) return { refundPlayerId: null, refundAmount: 0 };

  const maxCommitted = Math.max(...contributions.map((c) => c.committed));
  const topContributors = contributions.filter((c) => c.committed === maxCommitted);
  if (topContributors.length !== 1 || maxCommitted === 0) {
    return { refundPlayerId: null, refundAmount: 0 };
  }

  const rest = contributions.filter((c) => c.playerId !== topContributors[0].playerId);
  const secondHighest = rest.length > 0 ? Math.max(...rest.map((c) => c.committed)) : 0;
  const refundAmount = maxCommitted - secondHighest;
  if (refundAmount <= 0) return { refundPlayerId: null, refundAmount: 0 };
  return { refundPlayerId: topContributors[0].playerId, refundAmount };
}

/**
 * Builds the ordered list of pot layers from final per-player contributions
 * (call computeUncalledRefund() and apply it first). Each layer is the slice
 * of the pot between two consecutive distinct contribution levels, funded by
 * every player who contributed at least that level (folded players' chips
 * still fund the layer — they just aren't eligible to win it).
 */
export function computeSidePots(contributions: Contribution[]): PotLayer[] {
  const positive = contributions.filter((c) => c.committed > 0);
  if (positive.length === 0) return [];

  const levels = Array.from(new Set(positive.map((c) => c.committed))).sort((a, b) => a - b);
  const layers: PotLayer[] = [];
  let previousLevel = 0;

  for (const level of levels) {
    const contributors = positive.filter((c) => c.committed >= level);
    const amount = (level - previousLevel) * contributors.length;
    const eligible = contributors.filter((c) => !c.folded).map((c) => c.playerId);

    if (amount > 0) {
      if (eligible.length === 0) {
        // Defensive only — see module doc: given computeUncalledRefund() is
        // always applied first, every layer up to the top active player's
        // contribution level has at least that player eligible. Fold the
        // orphaned amount into the previous layer rather than losing chips.
        if (layers.length > 0) {
          layers[layers.length - 1].amount += amount;
        }
      } else {
        layers.push({ amount, eligiblePlayerIds: eligible });
      }
    }
    previousLevel = level;
  }

  return layers;
}

/**
 * Splits `amount` chips across `winnersInOrder` (already the tied winners of
 * one pot layer, pre-sorted starting from the seat immediately left of the
 * dealer button and wrapping around the table). Everyone gets the floor
 * share; the remainder is handed out one chip at a time in that order.
 */
export function splitPotAmount(amount: number, winnersInOrder: PlayerId[]): Map<PlayerId, number> {
  const result = new Map<PlayerId, number>();
  const n = winnersInOrder.length;
  if (n === 0) return result;

  const share = Math.floor(amount / n);
  const remainder = amount - share * n;
  for (const id of winnersInOrder) result.set(id, share);
  for (let i = 0; i < remainder; i++) {
    const id = winnersInOrder[i % n];
    result.set(id, (result.get(id) ?? 0) + 1);
  }
  return result;
}

/**
 * Orders `seats` (arbitrary subset of occupied seat numbers) starting from
 * the seat closest to the left of `dealerSeat` and wrapping around a table
 * of `totalSeats` seats. Used to put split-pot winners (and other
 * left-of-dealer orderings, e.g. action order) into the correct rotation.
 */
export function orderSeatsFromLeftOfDealer(seats: number[], dealerSeat: number, totalSeats: number): number[] {
  // Distance counts from dealerSeat + 1 (0) around to dealerSeat itself (totalSeats - 1), so
  // the dealer's own seat — if present in `seats` — always sorts last, never first.
  return seats
    .map((seat) => ({ seat, distance: (seat - dealerSeat - 1 + totalSeats) % totalSeats }))
    .sort((a, b) => a.distance - b.distance || a.seat - b.seat)
    .map((s) => s.seat);
}
