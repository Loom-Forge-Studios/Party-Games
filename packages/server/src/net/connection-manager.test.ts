import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ClientMessage, PlayerId } from '@party/protocol';
import { ConnectionManager } from './connection-manager.js';
import { FakeSocket } from './test-support/fake-socket.js';

function fakeClock(startMs = 0) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('ConnectionManager — handshake', () => {
  it('a fresh hello gets hello.ok with a new playerId + resumeToken', () => {
    const onHello = vi.fn();
    const manager = new ConnectionManager({ onHello });
    const socket = new FakeSocket();
    manager.handleConnection(socket);

    socket.emitMessage({ t: 'hello', username: 'alice' });

    expect(socket.receivedMessages).toHaveLength(1);
    const [reply] = socket.receivedMessages;
    expect(reply?.t).toBe('hello.ok');
    if (reply?.t !== 'hello.ok') throw new Error('expected hello.ok');
    expect(typeof reply.playerId).toBe('string');
    expect(reply.playerId.length).toBeGreaterThan(0);
    expect(typeof reply.resumeToken).toBe('string');

    expect(onHello).toHaveBeenCalledTimes(1);
    expect(onHello).toHaveBeenCalledWith(reply.playerId, expect.objectContaining({ username: 'alice' }), false);
  });

  it('two different sockets saying hello get two different playerIds', () => {
    const manager = new ConnectionManager();
    const a = new FakeSocket();
    const b = new FakeSocket();
    manager.handleConnection(a);
    manager.handleConnection(b);
    a.emitMessage({ t: 'hello', username: 'alice' });
    b.emitMessage({ t: 'hello', username: 'bob' });

    const aId = (a.receivedMessages[0] as { playerId: PlayerId }).playerId;
    const bId = (b.receivedMessages[0] as { playerId: PlayerId }).playerId;
    expect(aId).not.toBe(bId);
  });

  it('routes a validated post-hello message downstream via onMessage', () => {
    const onMessage = vi.fn();
    const manager = new ConnectionManager({ onMessage });
    const socket = new FakeSocket();
    manager.handleConnection(socket);
    socket.emitMessage({ t: 'hello', username: 'alice' });
    const playerId = (socket.receivedMessages[0] as { playerId: PlayerId }).playerId;

    const action: ClientMessage = { t: 'game.action', action: { move: 'e4' } };
    socket.emitMessage(action);

    expect(onMessage).toHaveBeenCalledWith(playerId, action);
  });

  it('rejects any non-hello message before hello, without forwarding it', () => {
    const onMessage = vi.fn();
    const manager = new ConnectionManager({ onMessage });
    const socket = new FakeSocket();
    manager.handleConnection(socket);

    socket.emitMessage({ t: 'chat', text: 'too early' });

    expect(onMessage).not.toHaveBeenCalled();
    const [reply] = socket.receivedMessages;
    expect(reply).toEqual({ t: 'error', code: 'ILLEGAL_ACTION', message: expect.any(String) });
  });

  it('answers app-level ping with pong without forwarding it downstream', () => {
    const onMessage = vi.fn();
    const manager = new ConnectionManager({ onMessage });
    const socket = new FakeSocket();
    manager.handleConnection(socket);
    socket.emitMessage({ t: 'hello', username: 'alice' });
    socket.emitMessage({ t: 'ping' });

    expect(onMessage).not.toHaveBeenCalled();
    expect(socket.receivedMessages.at(-1)).toEqual({ t: 'pong' });
  });
});

describe('ConnectionManager — reconnect / resume', () => {
  it('resumes within the 90s window: same playerId, marked connected again, resumed=true', () => {
    const clock = fakeClock();
    const onHello = vi.fn();
    const onDisconnect = vi.fn();
    const manager = new ConnectionManager({ session: { resumeWindowMs: 90_000, now: clock.now }, onHello, onDisconnect });

    const first = new FakeSocket();
    manager.handleConnection(first);
    first.emitMessage({ t: 'hello', username: 'alice' });
    const { playerId, resumeToken } = first.receivedMessages[0] as { playerId: PlayerId; resumeToken: string };

    first.close();
    expect(onDisconnect).toHaveBeenCalledWith(playerId);

    clock.advance(89_000);

    const second = new FakeSocket();
    manager.handleConnection(second);
    second.emitMessage({ t: 'hello', username: 'alice', resumeToken });

    const reply = second.receivedMessages[0] as { t: string; playerId: PlayerId; resumeToken: string };
    expect(reply.t).toBe('hello.ok');
    expect(reply.playerId).toBe(playerId);
    expect(onHello).toHaveBeenLastCalledWith(playerId, expect.anything(), true);
  });

  it('does not resume past the 90s window: falls back to a brand-new session', () => {
    const clock = fakeClock();
    const manager = new ConnectionManager({ session: { resumeWindowMs: 90_000, now: clock.now } });

    const first = new FakeSocket();
    manager.handleConnection(first);
    first.emitMessage({ t: 'hello', username: 'alice' });
    const { playerId: oldPlayerId, resumeToken } = first.receivedMessages[0] as {
      playerId: PlayerId;
      resumeToken: string;
    };
    first.close();

    clock.advance(90_001);

    const second = new FakeSocket();
    manager.handleConnection(second);
    second.emitMessage({ t: 'hello', username: 'alice', resumeToken });

    const reply = second.receivedMessages[0] as { t: string; playerId: PlayerId };
    expect(reply.t).toBe('hello.ok');
    expect(reply.playerId).not.toBe(oldPlayerId);
  });

  it('a reconnect with a bogus resumeToken silently falls back to a new session (never errors the client out)', () => {
    const manager = new ConnectionManager();
    const socket = new FakeSocket();
    manager.handleConnection(socket);
    socket.emitMessage({ t: 'hello', username: 'alice', resumeToken: 'this-token-was-never-issued' });

    const reply = socket.receivedMessages[0] as { t: string; playerId: PlayerId };
    expect(reply.t).toBe('hello.ok');
    expect(typeof reply.playerId).toBe('string');
  });

  it('a stale socket reconnecting for an identity another live socket now holds gets displaced', () => {
    const clock = fakeClock();
    const manager = new ConnectionManager({ session: { resumeWindowMs: 90_000, now: clock.now } });

    const first = new FakeSocket();
    manager.handleConnection(first);
    first.emitMessage({ t: 'hello', username: 'alice' });
    const { playerId, resumeToken } = first.receivedMessages[0] as { playerId: PlayerId; resumeToken: string };
    first.close();

    const second = new FakeSocket();
    manager.handleConnection(second);
    second.emitMessage({ t: 'hello', username: 'alice', resumeToken });
    expect((second.receivedMessages[0] as { playerId: PlayerId }).playerId).toBe(playerId);

    // A third socket resumes the same identity again (e.g. a duplicate tab).
    const third = new FakeSocket();
    manager.handleConnection(third);
    third.emitMessage({ t: 'hello', username: 'alice', resumeToken });

    expect(second.closed).toBeDefined();
    // Only the newest socket can now receive sends for this playerId.
    manager.send(playerId, { t: 'pong' });
    expect(third.receivedMessages.at(-1)).toEqual({ t: 'pong' });
  });
});

describe('ConnectionManager — malformed input', () => {
  it('malformed JSON gets an ILLEGAL_ACTION error and does not crash the connection', () => {
    const manager = new ConnectionManager();
    const socket = new FakeSocket();
    manager.handleConnection(socket);
    socket.emitMessage({ t: 'hello', username: 'alice' });

    expect(() => socket.emitRaw('{ this is not json')).not.toThrow();

    const last = socket.receivedMessages.at(-1);
    expect(last).toEqual({ t: 'error', code: 'ILLEGAL_ACTION', message: expect.any(String) });
    expect(manager.connectionCount).toBe(1); // still connected, not dropped
  });

  it('a well-formed-JSON-but-unknown-shape message is rejected the same way', () => {
    const manager = new ConnectionManager();
    const socket = new FakeSocket();
    manager.handleConnection(socket);
    socket.emitMessage({ t: 'hello', username: 'alice' });

    socket.emitMessage({ t: 'game.action' }); // missing required `action` key
    expect(socket.receivedMessages.at(-1)).toEqual({ t: 'error', code: 'ILLEGAL_ACTION', message: expect.any(String) });

    socket.emitMessage({ t: 'totally.unknown.type', foo: 'bar' });
    expect(socket.receivedMessages.at(-1)).toEqual({ t: 'error', code: 'ILLEGAL_ACTION', message: expect.any(String) });
  });

  it('an oversized frame is rejected without being parsed', () => {
    const manager = new ConnectionManager({ maxMessageBytes: 32 });
    const socket = new FakeSocket();
    manager.handleConnection(socket);
    socket.emitRaw(JSON.stringify({ t: 'hello', username: 'this-is-a-long-enough-username-to-blow-the-cap' }));

    expect(socket.receivedMessages.at(-1)).toEqual({ t: 'error', code: 'ILLEGAL_ACTION', message: expect.any(String) });
  });
});

describe('ConnectionManager — rate limiting', () => {
  it('emits RATE_LIMITED once the per-connection bucket is exhausted', () => {
    const clock = fakeClock();
    const manager = new ConnectionManager({ rateLimit: { capacity: 2, refillPerSecond: 1 }, now: clock.now });
    const socket = new FakeSocket();
    manager.handleConnection(socket);

    socket.emitMessage({ t: 'hello', username: 'alice' }); // consumes 1
    socket.emitMessage({ t: 'ping' }); // consumes 1, bucket now empty
    socket.emitMessage({ t: 'ping' }); // should be rate limited

    const last = socket.receivedMessages.at(-1);
    expect(last).toEqual({ t: 'error', code: 'RATE_LIMITED', message: expect.any(String) });
  });

  it('rate limiting applies even before hello (an unauthenticated flood is still a flood)', () => {
    const manager = new ConnectionManager({ rateLimit: { capacity: 1, refillPerSecond: 1 } });
    const socket = new FakeSocket();
    manager.handleConnection(socket);

    socket.emitMessage({ t: 'hello', username: 'x' }); // consumes the one token
    socket.emitMessage({ t: 'hello', username: 'y' }); // rate limited before shape is even considered

    const last = socket.receivedMessages.at(-1);
    expect(last).toEqual({ t: 'error', code: 'RATE_LIMITED', message: expect.any(String) });
  });

  it('refills over time so a slower client is not permanently limited', () => {
    const clock = fakeClock();
    const manager = new ConnectionManager({ rateLimit: { capacity: 1, refillPerSecond: 1 }, now: clock.now });
    const socket = new FakeSocket();
    manager.handleConnection(socket);

    socket.emitMessage({ t: 'hello', username: 'alice' });
    socket.emitMessage({ t: 'ping' });
    expect(socket.receivedMessages.at(-1)).toEqual({ t: 'error', code: 'RATE_LIMITED', message: expect.any(String) });

    clock.advance(1000);
    socket.emitMessage({ t: 'ping' });
    expect(socket.receivedMessages.at(-1)).toEqual({ t: 'pong' });
  });
});

describe('ConnectionManager — Transport implementation', () => {
  it('send() delivers to the right socket only', () => {
    const manager = new ConnectionManager();
    const a = new FakeSocket();
    const b = new FakeSocket();
    manager.handleConnection(a);
    manager.handleConnection(b);
    a.emitMessage({ t: 'hello', username: 'alice' });
    b.emitMessage({ t: 'hello', username: 'bob' });
    const aId = (a.receivedMessages[0] as { playerId: PlayerId }).playerId;

    manager.send(aId, { t: 'chat', from: aId, text: 'hi' });

    expect(a.receivedMessages.at(-1)).toEqual({ t: 'chat', from: aId, text: 'hi' });
    expect(b.receivedMessages.some((m) => m.t === 'chat')).toBe(false);
  });

  it('send() to an unknown/disconnected playerId is a no-op, not a throw', () => {
    const manager = new ConnectionManager();
    expect(() => manager.send('nobody', { t: 'pong' })).not.toThrow();
  });

  it('broadcast() delivers to every listed playerId', () => {
    const manager = new ConnectionManager();
    const a = new FakeSocket();
    const b = new FakeSocket();
    const c = new FakeSocket();
    manager.handleConnection(a);
    manager.handleConnection(b);
    manager.handleConnection(c);
    a.emitMessage({ t: 'hello', username: 'a' });
    b.emitMessage({ t: 'hello', username: 'b' });
    c.emitMessage({ t: 'hello', username: 'c' });
    const aId = (a.receivedMessages[0] as { playerId: PlayerId }).playerId;
    const bId = (b.receivedMessages[0] as { playerId: PlayerId }).playerId;

    manager.broadcast([aId, bId], { t: 'pong' });

    expect(a.receivedMessages.at(-1)).toEqual({ t: 'pong' });
    expect(b.receivedMessages.at(-1)).toEqual({ t: 'pong' });
    expect(c.receivedMessages.some((m) => m.t === 'pong')).toBe(false);
  });

  it('disconnect() closes the player\'s socket', () => {
    const manager = new ConnectionManager();
    const socket = new FakeSocket();
    manager.handleConnection(socket);
    socket.emitMessage({ t: 'hello', username: 'alice' });
    const playerId = (socket.receivedMessages[0] as { playerId: PlayerId }).playerId;

    manager.disconnect(playerId, 'kicked');

    expect(socket.closed).toEqual({ code: 1000, reason: 'kicked' });
  });
});

describe('ConnectionManager — heartbeat / dead socket detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings idle sockets and terminates ones that never pong back', () => {
    const onDisconnect = vi.fn();
    const manager = new ConnectionManager({ heartbeatIntervalMs: 1000, onDisconnect });
    const socket = new FakeSocket();
    manager.handleConnection(socket);
    socket.emitMessage({ t: 'hello', username: 'alice' });
    const playerId = (socket.receivedMessages[0] as { playerId: PlayerId }).playerId;

    manager.startHeartbeat();

    vi.advanceTimersByTime(1000); // first tick: sends a ping
    expect(socket.pingCount).toBe(1);
    expect(socket.terminated).toBe(false);

    vi.advanceTimersByTime(1000); // second tick: no pong arrived -> dead
    expect(socket.terminated).toBe(true);
    expect(onDisconnect).toHaveBeenCalledWith(playerId);

    manager.stopHeartbeat();
  });

  it('a socket that pongs back in time is kept alive and pinged again next tick', () => {
    const manager = new ConnectionManager({ heartbeatIntervalMs: 1000 });
    const socket = new FakeSocket();
    manager.handleConnection(socket);
    socket.emitMessage({ t: 'hello', username: 'alice' });

    manager.startHeartbeat();

    vi.advanceTimersByTime(1000);
    expect(socket.pingCount).toBe(1);
    socket.emitPong();

    vi.advanceTimersByTime(1000);
    expect(socket.pingCount).toBe(2);
    expect(socket.terminated).toBe(false);

    manager.stopHeartbeat();
  });
});
