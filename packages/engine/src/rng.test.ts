import { describe, it, expect } from 'vitest';
import { createRng } from './rng.js';

describe('createRng (mulberry32)', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.float()).not.toBe(b.float());
  });

  it('int() stays within [0, maxExclusive)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const n = rng.int(6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('shuffle() is a permutation and is deterministic per seed', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffledA = createRng(99).shuffle(items);
    const shuffledB = createRng(99).shuffle(items);
    expect(shuffledA).toEqual(shuffledB);
    expect([...shuffledA].sort((x, y) => x - y)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // does not mutate input
  });
});
