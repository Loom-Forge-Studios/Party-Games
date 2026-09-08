import { describe, it, expect } from 'vitest';
import { SessionRegistry } from './session.js';

function fakeClock(startMs = 0) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function idGen(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

describe('SessionRegistry', () => {
  it('create() issues a fresh playerId + resumeToken and starts connected', () => {
    const registry = new SessionRegistry({ generateId: idGen('id') });
    const session = registry.create('alice');
    expect(session.playerId).toBe('id1');
    expect(session.resumeToken).toBe('id2');
    expect(session.username).toBe('alice');
    expect(session.connected).toBe(true);
    expect(session.disconnectedAt).toBeNull();
  });

  it('resume() reclaims a session within the resume window', () => {
    const clock = fakeClock();
    const registry = new SessionRegistry({ resumeWindowMs: 90_000, now: clock.now });
    const session = registry.create('bob');

    registry.markDisconnected(session.playerId);
    clock.advance(89_999);

    const resumed = registry.resume(session.resumeToken);
    expect(resumed).toBeDefined();
    expect(resumed?.playerId).toBe(session.playerId);
    expect(resumed?.connected).toBe(true);
    expect(resumed?.disconnectedAt).toBeNull();
  });

  it('resume() rejects (and evicts) a session past the resume window', () => {
    const clock = fakeClock();
    const registry = new SessionRegistry({ resumeWindowMs: 90_000, now: clock.now });
    const session = registry.create('carol');

    registry.markDisconnected(session.playerId);
    clock.advance(90_001);

    expect(registry.resume(session.resumeToken)).toBeUndefined();
    // The expired session is actually gone, not just unresumable.
    expect(registry.get(session.playerId)).toBeUndefined();
    expect(registry.resume(session.resumeToken)).toBeUndefined();
  });

  it('resume() rejects an unknown token without throwing', () => {
    const registry = new SessionRegistry();
    expect(registry.resume('not-a-real-token')).toBeUndefined();
  });

  it('a still-connected session (no disconnectedAt) resumes regardless of elapsed time', () => {
    const clock = fakeClock();
    const registry = new SessionRegistry({ resumeWindowMs: 1000, now: clock.now });
    const session = registry.create('dana');
    clock.advance(10_000);
    expect(registry.resume(session.resumeToken)).toBeDefined();
  });

  it('sweepExpired() evicts every session past its window and returns their ids', () => {
    const clock = fakeClock();
    const registry = new SessionRegistry({ resumeWindowMs: 100, now: clock.now });
    const stale = registry.create('stale');
    const fresh = registry.create('fresh');
    registry.markDisconnected(stale.playerId);
    registry.markDisconnected(fresh.playerId);
    clock.advance(50);
    // fresh reconnects right before it would expire.
    registry.resume(fresh.resumeToken);
    clock.advance(60); // stale is now 110ms disconnected; fresh reconnected 60ms ago.

    const expired = registry.sweepExpired();
    expect(expired).toEqual([stale.playerId]);
    expect(registry.get(stale.playerId)).toBeUndefined();
    expect(registry.get(fresh.playerId)).toBeDefined();
  });
});
