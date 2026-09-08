import { describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@party/protocol';
import { Connection, type KeyValueStorage, type WebSocketLike } from './connection.js';

const OPEN = 1;
const CLOSED = 3;

/** In-memory Storage fake — Connection only needs get/set/remove. */
function fakeStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** A controllable fake WebSocket the test drives by hand (no real network). */
class FakeSocket implements WebSocketLike {
  readyState = OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = CLOSED;
    this.onclose?.();
  }
  /** Test helper: simulate the server accepting the connection. */
  simulateOpen(): void {
    this.onopen?.();
  }
  /** Test helper: simulate a server message arriving. */
  simulateMessage(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  /** Test helper: simulate the socket dropping (network blip, server restart, ...). */
  simulateDrop(): void {
    this.readyState = CLOSED;
    this.onclose?.();
  }
}

function lastSent(socket: FakeSocket): ClientMessage {
  return JSON.parse(socket.sent[socket.sent.length - 1]) as ClientMessage;
}

describe('Connection', () => {
  it('sends hello with the chosen username and no resumeToken on a first connect', () => {
    const sockets: FakeSocket[] = [];
    const connection = new Connection({
      url: 'ws://test',
      username: 'alice',
      storage: fakeStorage(),
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });

    connection.connect();
    sockets[0].simulateOpen();

    expect(lastSent(sockets[0])).toEqual({ t: 'hello', username: 'alice' });
  });

  it('persists the resumeToken from hello.ok and replays it on the next hello', () => {
    const storage = fakeStorage();
    const sockets: FakeSocket[] = [];
    const connection = new Connection({
      url: 'ws://test',
      username: 'alice',
      storage,
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });

    connection.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateMessage({ t: 'hello.ok', playerId: 'p1', resumeToken: 'tok-123' });

    expect(storage.getItem('party-games:resumeToken')).toBe('tok-123');
    expect(connection.getStoredResumeToken()).toBe('tok-123');

    // Simulate a fresh Connection instance (e.g. page reload) picking the
    // token back up from the same storage.
    const sockets2: FakeSocket[] = [];
    const reconnectedApp = new Connection({
      url: 'ws://test',
      username: 'alice',
      storage,
      wsFactory: () => {
        const s = new FakeSocket();
        sockets2.push(s);
        return s;
      },
    });
    reconnectedApp.connect();
    sockets2[0].simulateOpen();

    expect(lastSent(sockets2[0])).toEqual({ t: 'hello', username: 'alice', resumeToken: 'tok-123' });
  });

  it('auto-reconnects with backoff after the socket drops, and does not reconnect after an explicit disconnect', () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeSocket[] = [];
      const connection = new Connection({
        url: 'ws://test',
        username: 'bob',
        storage: fakeStorage(),
        minBackoffMs: 100,
        maxBackoffMs: 1000,
        wsFactory: () => {
          const s = new FakeSocket();
          sockets.push(s);
          return s;
        },
      });

      connection.connect();
      expect(sockets).toHaveLength(1);
      sockets[0].simulateOpen();
      expect(connection.getStatus()).toBe('open');

      sockets[0].simulateDrop();
      expect(connection.getStatus()).toBe('reconnecting');
      expect(sockets).toHaveLength(1); // no new socket until backoff elapses

      vi.advanceTimersByTime(100);
      expect(sockets).toHaveLength(2);
      sockets[1].simulateOpen();
      expect(connection.getStatus()).toBe('open');

      // Explicit disconnect: no further auto-reconnect.
      connection.disconnect();
      expect(connection.getStatus()).toBe('closed');
      vi.advanceTimersByTime(5000);
      expect(sockets).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops sends while not open rather than throwing', () => {
    const sockets: FakeSocket[] = [];
    const connection = new Connection({
      url: 'ws://test',
      username: 'carol',
      storage: fakeStorage(),
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });

    // Never connected: send() must not throw even though there's no socket.
    expect(() => connection.send({ t: 'ping' })).not.toThrow();

    connection.connect();
    sockets[0].readyState = 0; // CONNECTING, not OPEN yet
    connection.send({ t: 'ping' });
    expect(sockets[0].sent).toHaveLength(0);
  });

  it('notifies message listeners for every parsed ServerMessage', () => {
    const sockets: FakeSocket[] = [];
    const connection = new Connection({
      url: 'ws://test',
      username: 'dave',
      storage: fakeStorage(),
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });

    const received: ServerMessage[] = [];
    connection.onMessage((m) => received.push(m));

    connection.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateMessage({ t: 'pong' });

    expect(received).toContainEqual({ t: 'pong' });
  });
});
