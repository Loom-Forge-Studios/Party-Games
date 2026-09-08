import { describe, expect, it } from 'vitest';
import { computeSidePots, computeUncalledRefund, orderSeatsFromLeftOfDealer, splitPotAmount, type Contribution } from './pots.js';

describe('computeSidePots — 3+ players all-in at different stack sizes', () => {
  it('builds one layer per distinct commitment level, with the correct eligible winners each', () => {
    const contributions: Contribution[] = [
      { playerId: 'A', committed: 100, folded: false }, // short-stack all-in
      { playerId: 'B', committed: 300, folded: false }, // mid-stack all-in
      { playerId: 'C', committed: 500, folded: false }, // deep-stack all-in
    ];

    const layers = computeSidePots(contributions);

    expect(layers).toEqual([
      { amount: 300, eligiblePlayerIds: ['A', 'B', 'C'] }, // 100 * 3 contributors
      { amount: 400, eligiblePlayerIds: ['B', 'C'] }, // 200 * 2 contributors
      { amount: 200, eligiblePlayerIds: ['C'] }, // 200 * 1 contributor
    ]);

    const totalAwarded = layers.reduce((sum, l) => sum + l.amount, 0);
    const totalContributed = contributions.reduce((sum, c) => sum + c.committed, 0);
    expect(totalAwarded).toBe(totalContributed);
  });

  it('excludes folded players from eligibility while still counting their chips into every layer they funded', () => {
    const contributions: Contribution[] = [
      { playerId: 'D', committed: 50, folded: true }, // folded early, chips still at risk
      { playerId: 'A', committed: 100, folded: false },
      { playerId: 'B', committed: 300, folded: false },
      { playerId: 'C', committed: 500, folded: false },
    ];

    const layers = computeSidePots(contributions);

    expect(layers).toEqual([
      { amount: 200, eligiblePlayerIds: ['A', 'B', 'C'] }, // 50 * 4 contributors, D excluded from eligibility
      { amount: 150, eligiblePlayerIds: ['A', 'B', 'C'] }, // 50 * 3 (D dropped out of this level)
      { amount: 400, eligiblePlayerIds: ['B', 'C'] },
      { amount: 200, eligiblePlayerIds: ['C'] },
    ]);

    const totalAwarded = layers.reduce((sum, l) => sum + l.amount, 0);
    const totalContributed = contributions.reduce((sum, c) => sum + c.committed, 0);
    expect(totalAwarded).toBe(totalContributed);
  });

  it('produces a single pot when nobody is short-stacked', () => {
    const contributions: Contribution[] = [
      { playerId: 'A', committed: 200, folded: false },
      { playerId: 'B', committed: 200, folded: false },
      { playerId: 'C', committed: 200, folded: true },
    ];
    expect(computeSidePots(contributions)).toEqual([{ amount: 600, eligiblePlayerIds: ['A', 'B'] }]);
  });

  it('returns no layers when nobody has contributed', () => {
    expect(computeSidePots([])).toEqual([]);
  });
});

describe('computeUncalledRefund', () => {
  it('refunds the gap between the sole top contributor and the next-highest contribution', () => {
    const contributions: Contribution[] = [
      { playerId: 'A', committed: 100, folded: false },
      { playerId: 'B', committed: 300, folded: false },
      { playerId: 'C', committed: 500, folded: false },
    ];
    expect(computeUncalledRefund(contributions)).toEqual({ refundPlayerId: 'C', refundAmount: 200 });
  });

  it('counts a folded player toward "covered", not just active ones', () => {
    const contributions: Contribution[] = [
      { playerId: 'D', committed: 450, folded: true },
      { playerId: 'C', committed: 500, folded: false },
    ];
    expect(computeUncalledRefund(contributions)).toEqual({ refundPlayerId: 'C', refundAmount: 50 });
  });

  it('refunds nothing when two or more players share the top commitment', () => {
    const contributions: Contribution[] = [
      { playerId: 'A', committed: 500, folded: false },
      { playerId: 'B', committed: 500, folded: false },
    ];
    expect(computeUncalledRefund(contributions)).toEqual({ refundPlayerId: null, refundAmount: 0 });
  });

  it('refunds nothing given no contributions', () => {
    expect(computeUncalledRefund([])).toEqual({ refundPlayerId: null, refundAmount: 0 });
  });
});

describe('splitPotAmount — odd-chip remainder', () => {
  it('gives everyone the floor share, then hands the remainder out in order starting from the front of the list', () => {
    const split = splitPotAmount(100, ['X', 'Y', 'Z']);
    expect(split.get('X')).toBe(34);
    expect(split.get('Y')).toBe(33);
    expect(split.get('Z')).toBe(33);
    expect([...split.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('divides evenly with no remainder to allocate', () => {
    const split = splitPotAmount(90, ['X', 'Y', 'Z']);
    expect(split.get('X')).toBe(30);
    expect(split.get('Y')).toBe(30);
    expect(split.get('Z')).toBe(30);
  });

  it('gives the whole amount to a single winner', () => {
    const split = splitPotAmount(77, ['X']);
    expect(split.get('X')).toBe(77);
  });
});

describe('orderSeatsFromLeftOfDealer', () => {
  it('starts immediately left of the dealer and puts the dealer itself last', () => {
    expect(orderSeatsFromLeftOfDealer([0, 1, 2, 3], 1, 4)).toEqual([2, 3, 0, 1]);
  });

  it('wraps correctly when the dealer is the highest-numbered seat', () => {
    expect(orderSeatsFromLeftOfDealer([0, 1, 2, 3], 3, 4)).toEqual([0, 1, 2, 3]);
  });

  it('only orders the seats given, ignoring seats not present in the input', () => {
    expect(orderSeatsFromLeftOfDealer([0, 2], 1, 4)).toEqual([2, 0]);
  });
});
