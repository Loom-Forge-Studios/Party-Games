import { describe, expect, it } from 'vitest';
import type { Card, Suit } from './deck.js';
import { HAND_CATEGORY, bestHandOf, compareHandScores } from './evaluator.js';

function c(rank: number, suit: Suit): Card {
  return { rank, suit };
}

describe('bestHandOf — known rankings', () => {
  it('recognises a royal flush', () => {
    const hand = bestHandOf([c(14, 'S'), c(13, 'S'), c(12, 'S'), c(11, 'S'), c(10, 'S'), c(2, 'H'), c(3, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.STRAIGHT_FLUSH);
    expect(hand.tiebreakers).toEqual([14]);
  });

  it('recognises the wheel straight (A-2-3-4-5), ace counting low', () => {
    const hand = bestHandOf([c(14, 'S'), c(2, 'H'), c(3, 'D'), c(4, 'C'), c(5, 'S'), c(9, 'H'), c(10, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.STRAIGHT);
    expect(hand.tiebreakers).toEqual([5]);
  });

  it('recognises the steel wheel (A-2-3-4-5 suited) as a straight flush topping out at 5', () => {
    const hand = bestHandOf([c(14, 'S'), c(2, 'S'), c(3, 'S'), c(4, 'S'), c(5, 'S'), c(9, 'H'), c(10, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.STRAIGHT_FLUSH);
    expect(hand.tiebreakers).toEqual([5]);
  });

  it('ranks a 6-high straight flush above the steel wheel', () => {
    const wheel = bestHandOf([c(14, 'S'), c(2, 'S'), c(3, 'S'), c(4, 'S'), c(5, 'S'), c(9, 'H'), c(10, 'D')]);
    const sixHigh = bestHandOf([c(2, 'H'), c(3, 'H'), c(4, 'H'), c(5, 'H'), c(6, 'H'), c(9, 'S'), c(10, 'D')]);
    expect(compareHandScores(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it('recognises four of a kind with the correct kicker', () => {
    const hand = bestHandOf([c(9, 'S'), c(9, 'H'), c(9, 'D'), c(9, 'C'), c(2, 'S'), c(14, 'H'), c(5, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.FOUR_OF_A_KIND);
    expect(hand.tiebreakers).toEqual([9, 14]);
  });

  it('recognises a full house, using the best trips + best pair available', () => {
    // 9-9-9-K-K-2-2 -> full house nines full of kings (kings pair beats twos pair)
    const hand = bestHandOf([c(9, 'S'), c(9, 'H'), c(9, 'D'), c(13, 'C'), c(13, 'S'), c(2, 'H'), c(2, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.FULL_HOUSE);
    expect(hand.tiebreakers).toEqual([9, 13]);
  });

  it('recognises a flush and ranks it by highest cards', () => {
    const hand = bestHandOf([c(2, 'S'), c(5, 'S'), c(9, 'S'), c(11, 'S'), c(13, 'S'), c(4, 'H'), c(6, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.FLUSH);
    expect(hand.tiebreakers).toEqual([13, 11, 9, 5, 2]);
  });

  it('recognises a straight (non-wheel)', () => {
    const hand = bestHandOf([c(6, 'S'), c(7, 'H'), c(8, 'D'), c(9, 'C'), c(10, 'S'), c(2, 'H'), c(3, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.STRAIGHT);
    expect(hand.tiebreakers).toEqual([10]);
  });

  it('recognises three of a kind with kickers', () => {
    const hand = bestHandOf([c(7, 'S'), c(7, 'H'), c(7, 'D'), c(2, 'C'), c(5, 'S'), c(14, 'H'), c(9, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.THREE_OF_A_KIND);
    expect(hand.tiebreakers).toEqual([7, 14, 9]);
  });

  it('recognises two pair, ranking the higher pair first', () => {
    const hand = bestHandOf([c(4, 'S'), c(4, 'H'), c(11, 'D'), c(11, 'C'), c(2, 'S'), c(9, 'H'), c(6, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.TWO_PAIR);
    expect(hand.tiebreakers).toEqual([11, 4, 9]);
  });

  it('recognises one pair with three kickers', () => {
    const hand = bestHandOf([c(8, 'S'), c(8, 'H'), c(2, 'D'), c(5, 'C'), c(9, 'S'), c(14, 'H'), c(3, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.ONE_PAIR);
    expect(hand.tiebreakers).toEqual([8, 14, 9, 5]);
  });

  it('recognises high card', () => {
    const hand = bestHandOf([c(2, 'S'), c(5, 'H'), c(9, 'D'), c(11, 'C'), c(14, 'S'), c(7, 'H'), c(3, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.HIGH_CARD);
    expect(hand.tiebreakers).toEqual([14, 11, 9, 7, 5]);
  });

  it('picks the best 5 of 7 — a 5-card flush beats a weaker 4-flush-plus-pair reading of the same cards', () => {
    // Hole: AS KS; board: QS 9S 2S 4H 4D -> a full spade flush (A K Q 9 2) is available and
    // must be chosen over the board's own pair of fours.
    const hand = bestHandOf([c(14, 'S'), c(13, 'S'), c(12, 'S'), c(9, 'S'), c(2, 'S'), c(4, 'H'), c(4, 'D')]);
    expect(hand.category).toBe(HAND_CATEGORY.FLUSH);
    expect(hand.tiebreakers).toEqual([14, 13, 12, 9, 2]);
  });
});

describe('compareHandScores', () => {
  it('orders categories correctly regardless of tiebreaker values', () => {
    const pair = bestHandOf([c(8, 'S'), c(8, 'H'), c(2, 'D'), c(5, 'C'), c(9, 'S'), c(11, 'H'), c(3, 'D')]);
    const flush = bestHandOf([c(2, 'S'), c(5, 'S'), c(9, 'S'), c(11, 'S'), c(13, 'S'), c(4, 'H'), c(6, 'D')]);
    expect(compareHandScores(flush, pair)).toBeGreaterThan(0);
    expect(compareHandScores(pair, flush)).toBeLessThan(0);
  });

  it('returns 0 for an exact tie (same category, same tiebreakers)', () => {
    const a = bestHandOf([c(9, 'S'), c(9, 'H'), c(2, 'D'), c(5, 'C'), c(11, 'S'), c(14, 'H'), c(3, 'D')]);
    const b = bestHandOf([c(9, 'D'), c(9, 'C'), c(2, 'S'), c(5, 'H'), c(11, 'D'), c(14, 'S'), c(3, 'C')]);
    expect(compareHandScores(a, b)).toBe(0);
  });
});
