// 7-card Texas Hold'em hand evaluation: best 5 of (2 hole + 5 community).
//
// A HandScore is a (category, tiebreakers) pair. Category is 0 (high card)
// through 8 (straight flush); two scores compare by category first, then by
// their tiebreaker arrays lexicographically (both arrays are the same
// length for hands of the same category). This is a total order except for
// genuine ties, which is exactly what showdown split-pot logic needs.
//
// The wheel (A-2-3-4-5, ace counts LOW) and the steel wheel (the same five
// ranks, suited, i.e. the lowest possible straight flush) are both handled
// by isStraight() below, which always reports the wheel's top card as 5 —
// so a 6-high straight (flush or not) correctly outranks it, and a
// steel-wheel straight flush correctly outranks every non-straight-flush
// hand while itself losing to a 6-high (or better) straight flush.

import type { Card } from './deck.js';

export const HAND_CATEGORY = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export type HandCategory = (typeof HAND_CATEGORY)[keyof typeof HAND_CATEGORY];

const CATEGORY_LABEL: Record<HandCategory, string> = {
  0: 'High Card',
  1: 'One Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
};

export interface HandScore {
  category: HandCategory;
  /** Same length for any two hands of the same category; compared lexicographically, highest first. */
  tiebreakers: number[];
  /** Human-readable label, e.g. "Full House" — doesn't include kickers. */
  label: string;
  /** The 5 cards making up the best hand, for showdown display. */
  cards: Card[];
}

/** Positive if a beats b, negative if b beats a, 0 on an exact tie. */
export function compareHandScores(a: HandScore, b: HandScore): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < a.tiebreakers.length; i++) {
    const diff = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Distinct ranks present, sorted descending, ace-high (14). */
function distinctRanksDesc(cards: Card[]): number[] {
  return Array.from(new Set(cards.map((c) => c.rank))).sort((a, b) => b - a);
}

/**
 * Detects a 5-card straight among the given ranks (duplicates allowed in
 * input; only distinctness matters). Returns the top card's rank, with the
 * wheel (A-2-3-4-5) reported as 5 (ace counts low), or null if no straight
 * exists.
 */
function findStraightTop(ranks: number[]): number | null {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1); // ace also counts low for wheel detection
  const sorted = Array.from(set).sort((a, b) => b - a);
  for (let i = 0; i <= sorted.length - 5; i++) {
    let consecutive = true;
    for (let k = 0; k < 4; k++) {
      if (sorted[i + k] - sorted[i + k + 1] !== 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) return sorted[i];
  }
  return null;
}

/** Evaluates exactly 5 cards. */
function evaluate5(cards: Card[]): HandScore {
  if (cards.length !== 5) {
    throw new RangeError(`evaluate5 requires exactly 5 cards, got ${cards.length}`);
  }

  const isFlush = cards.every((c) => c.suit === cards[0].suit);
  const straightTop = findStraightTop(cards.map((c) => c.rank));

  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  // Sort by count desc, then rank desc — this order is exactly the tiebreaker order for every
  // paired category (quads/full-house/trips/two-pair/pair) once flattened.
  const byCountThenRank = Array.from(counts.entries()).sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : b[0] - a[0]));

  const make = (category: HandCategory, tiebreakers: number[]): HandScore => ({
    category,
    tiebreakers,
    label: CATEGORY_LABEL[category],
    cards: cards.slice(),
  });

  if (isFlush && straightTop !== null) {
    return make(HAND_CATEGORY.STRAIGHT_FLUSH, [straightTop]);
  }
  if (byCountThenRank[0][1] === 4) {
    const quad = byCountThenRank[0][0];
    const kicker = byCountThenRank[1][0];
    return make(HAND_CATEGORY.FOUR_OF_A_KIND, [quad, kicker]);
  }
  if (byCountThenRank[0][1] === 3 && byCountThenRank[1][1] === 2) {
    return make(HAND_CATEGORY.FULL_HOUSE, [byCountThenRank[0][0], byCountThenRank[1][0]]);
  }
  if (isFlush) {
    return make(HAND_CATEGORY.FLUSH, distinctRanksDesc(cards));
  }
  if (straightTop !== null) {
    return make(HAND_CATEGORY.STRAIGHT, [straightTop]);
  }
  if (byCountThenRank[0][1] === 3) {
    const trips = byCountThenRank[0][0];
    const kickers = byCountThenRank
      .slice(1)
      .map(([rank]) => rank)
      .sort((a, b) => b - a);
    return make(HAND_CATEGORY.THREE_OF_A_KIND, [trips, ...kickers]);
  }
  if (byCountThenRank[0][1] === 2 && byCountThenRank[1][1] === 2) {
    const [highPair, lowPair] = [byCountThenRank[0][0], byCountThenRank[1][0]].sort((a, b) => b - a);
    const kicker = byCountThenRank[2][0];
    return make(HAND_CATEGORY.TWO_PAIR, [highPair, lowPair, kicker]);
  }
  if (byCountThenRank[0][1] === 2) {
    const pair = byCountThenRank[0][0];
    const kickers = byCountThenRank
      .slice(1)
      .map(([rank]) => rank)
      .sort((a, b) => b - a);
    return make(HAND_CATEGORY.ONE_PAIR, [pair, ...kickers]);
  }
  return make(HAND_CATEGORY.HIGH_CARD, distinctRanksDesc(cards));
}

function* combinations5(cards: Card[]): Generator<Card[]> {
  const n = cards.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          for (let e = d + 1; e < n; e++) {
            yield [cards[a], cards[b], cards[c], cards[d], cards[e]];
          }
        }
      }
    }
  }
}

/**
 * Best possible 5-card hand out of any 5-7 cards (holdem always calls this
 * with exactly 7: 2 hole + 5 community). Tries all C(n,5) combinations —
 * 21 for n=7 — and keeps the best by compareHandScores.
 */
export function bestHandOf(cards: Card[]): HandScore {
  if (cards.length < 5) {
    throw new RangeError(`bestHandOf requires at least 5 cards, got ${cards.length}`);
  }
  if (cards.length === 5) return evaluate5(cards);

  let best: HandScore | null = null;
  for (const combo of combinations5(cards)) {
    const score = evaluate5(combo);
    if (!best || compareHandScores(score, best) > 0) best = score;
  }
  return best as HandScore;
}
