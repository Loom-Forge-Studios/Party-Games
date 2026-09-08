import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rate-limit.js';

function fakeClock(startMs = 0) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('RateLimiter', () => {
  it('allows up to capacity requests, then rejects', () => {
    const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 1 });
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(false);
  });

  it('refills over time', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 1, now: clock.now });
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(false);

    clock.advance(1000); // +1 token
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(false);
  });

  it('never refills past capacity', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 100, now: clock.now });
    clock.advance(10_000); // would be 1000 tokens if unbounded
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(false);
  });

  it('tracks separate buckets per key', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    expect(limiter.tryConsume('b')).toBe(true);
  });

  it('reset() drops a key so it starts fresh', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(false);
    limiter.reset('k');
    expect(limiter.tryConsume('k')).toBe(true);
  });
});
