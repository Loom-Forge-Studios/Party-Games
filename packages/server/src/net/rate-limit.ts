/**
 * Per-connection token-bucket rate limiter. Cheap (a handful of numbers per
 * key, no timers) so it stays fine on modest hardware with many concurrent
 * sockets — buckets are refilled lazily on each check, not on an interval.
 */
export interface RateLimiterOptions {
  /** Max tokens a bucket can hold (burst size). */
  capacity: number;
  /** Tokens restored per second. */
  refillPerSecond: number;
  /** Injectable clock for deterministic tests. Default Date.now. */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions) {
    if (options.capacity <= 0) throw new RangeError('RateLimiter: capacity must be positive');
    if (options.refillPerSecond <= 0) throw new RangeError('RateLimiter: refillPerSecond must be positive');
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? Date.now;
  }

  /** Attempts to consume `cost` tokens for `key`. Returns false if the bucket is empty. */
  tryConsume(key: string, cost = 1): boolean {
    const nowMs = this.now();
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = { tokens: this.capacity, lastRefillMs: nowMs };
      this.buckets.set(key, bucket);
    } else {
      const elapsedSeconds = Math.max(0, nowMs - bucket.lastRefillMs) / 1000;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
      bucket.lastRefillMs = nowMs;
    }
    if (bucket.tokens < cost) return false;
    bucket.tokens -= cost;
    return true;
  }

  /** Drops a key's bucket entirely (e.g. once its connection closes). */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }
}
