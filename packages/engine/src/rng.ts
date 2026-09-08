/**
 * Injected randomness source. Game modules must never call Math.random()
 * directly — all randomness flows through an Rng passed in via SetupCtx /
 * ReduceCtx so games stay deterministic and replayable/testable.
 */
export interface Rng {
  int(maxExclusive: number): number;
  float(): number;
  shuffle<T>(items: T[]): T[];
}

/**
 * Deterministic, reproducibly-seedable Rng (mulberry32). Not cryptographically
 * secure — fine for game shuffles/dice, not for anything security-sensitive.
 */
export class Mulberry32Rng implements Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  private next32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  float(): number {
    return this.next32() / 4294967296;
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError('Rng.int: maxExclusive must be a positive integer');
    }
    return Math.floor(this.float() * maxExclusive);
  }

  shuffle<T>(items: T[]): T[] {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = result[i] as T;
      const b = result[j] as T;
      result[i] = b;
      result[j] = a;
    }
    return result;
  }
}

/** Convenience factory — `createRng(Date.now())` for a fresh game, or a fixed
 * number for deterministic tests/replays. */
export function createRng(seed: number): Rng {
  return new Mulberry32Rng(seed);
}
