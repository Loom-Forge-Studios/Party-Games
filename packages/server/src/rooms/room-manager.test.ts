import { describe, it, expect, beforeEach } from 'vitest';
import type { PlayerId, ServerMessage, RoomState } from '@party/protocol';
import { registerGame } from '@party/engine';
import type { Transport } from '../net/transport.js';
import { RoomManagerImpl } from './room-manager.js';

/** Hand-rolled fake Transport (no real net layer exists yet this wave). */
class FakeTransport implements Transport {
  sent: Array<{ playerId: PlayerId; message: ServerMessage }> = [];
  broadcasts: Array<{ playerIds: PlayerId[]; message: ServerMessage }> = [];
  disconnected: Array<{ playerId: PlayerId; reason?: string }> = [];

  send(playerId: PlayerId, message: ServerMessage): void {
    this.sent.push({ playerId, message });
  }

  broadcast(playerIds: PlayerId[], message: ServerMessage): void {
    this.broadcasts.push({ playerIds: [...playerIds], message });
  }

  disconnect(playerId: PlayerId, reason?: string): void {
    this.disconnected.push({ playerId, reason });
  }

  /** Last room.state broadcast, decoded. */
  lastRoomState(): RoomState {
    for (let i = this.broadcasts.length - 1; i >= 0; i--) {
      const msg = this.broadcasts[i].message;
      if (msg.t === 'room.state') return msg.room;
    }
    throw new Error('no room.state broadcast yet');
  }
}

function makeManager() {
  const transport = new FakeTransport();
  const random = (() => {
    // Deterministic sequence so generated room codes are reproducible in
    // tests, per the "no Math.random() habit" instruction — generateRoomId
    // itself lives in @party/protocol and is a display helper, not game
    // logic, but there is no reason not to inject a fixed source here too.
    let i = 0;
    const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    return () => seq[i++ % seq.length];
  })();
  const manager = new RoomManagerImpl(transport, random);
  return { transport, manager };
}

describe('RoomManagerImpl', () => {
  beforeEach(() => {
    // 'checkers' stub meta from @party/engine's registry is minPlayers:2,
    // maxPlayers:8, no teams. Individual tests that need different bounds
    // register their own throwaway gameIds instead of mutating this one.
  });

  it('creates a room, seats the creator as host at seat 0', () => {
    const { manager } = makeManager();
    const result = manager.createRoom('p1', 'Alice', 'checkers', 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const room = manager.getRoom(result.roomId);
    expect(room).toBeDefined();
    expect(room!.hostId).toBe('p1');
    expect(room!.players).toEqual([
      { id: 'p1', username: 'Alice', seat: 0, connected: true, isHost: true },
    ]);
    expect(room!.phase).toBe('lobby');
  });

  it('join: rejects ROOM_NOT_FOUND for an unknown code', () => {
    const { manager } = makeManager();
    const result = manager.joinRoom('p2', 'Bob', 'ZZZZ');
    expect(result).toEqual({ ok: false, code: 'ROOM_NOT_FOUND', message: expect.any(String) });
  });

  it('join: rejects ROOM_FULL once maxPlayers is reached', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('p1', 'Alice', 'checkers', 2);
    if (!created.ok) throw new Error('setup failed');
    const ok = manager.joinRoom('p2', 'Bob', created.roomId);
    expect(ok.ok).toBe(true);
    const full = manager.joinRoom('p3', 'Carol', created.roomId);
    expect(full).toEqual({ ok: false, code: 'ROOM_FULL', message: expect.any(String) });
  });

  it('join: rejects USERNAME_TAKEN within the same room (case-insensitive)', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('p1', 'Alice', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    const dupe = manager.joinRoom('p2', 'alice', created.roomId);
    expect(dupe).toEqual({ ok: false, code: 'USERNAME_TAKEN', message: expect.any(String) });
  });

  it('kick: a non-host attempting to kick is rejected with NOT_HOST', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId);
    manager.joinRoom('p3', 'Carol', created.roomId);

    const result = manager.kickPlayer('p2', 'p3');
    expect(result).toEqual({ ok: false, code: 'NOT_HOST', message: expect.any(String) });
    // Carol is still in the room.
    const room = manager.getRoom(created.roomId)!;
    expect(room.players.map((p) => p.id)).toContain('p3');
  });

  it('kick: compacts seats to 0..n-1 and re-broadcasts RoomState', () => {
    const { manager, transport } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId); // seat 1
    manager.joinRoom('p3', 'Carol', created.roomId); // seat 2
    manager.joinRoom('p4', 'Dave', created.roomId); // seat 3

    const before = transport.broadcasts.length;
    const result = manager.kickPlayer('host', 'p2');
    expect(result).toEqual({ ok: true });
    expect(transport.broadcasts.length).toBeGreaterThan(before);

    const room = manager.getRoom(created.roomId)!;
    const seats = room.players.map((p) => ({ id: p.id, seat: p.seat }));
    expect(seats).toEqual([
      { id: 'host', seat: 0 },
      { id: 'p3', seat: 1 },
      { id: 'p4', seat: 2 },
    ]);
    // Stable indices 0..n-1, no gaps.
    expect(room.players.map((p) => p.seat)).toEqual([0, 1, 2]);
  });

  it('kick: host cannot kick themselves', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    const result = manager.kickPlayer('host', 'host');
    expect(result.ok).toBe(false);
  });

  it('config: change/kick/start by non-host is rejected with NOT_HOST (all four host-only actions)', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId);

    expect(manager.configureRoom('p2', { maxPlayers: 4 })).toEqual({
      ok: false,
      code: 'NOT_HOST',
      message: expect.any(String),
    });
    expect(manager.configureRoom('p2', { gameId: 'holdem' })).toEqual({
      ok: false,
      code: 'NOT_HOST',
      message: expect.any(String),
    });
    expect(manager.startRoom('p2')).toEqual({ ok: false, code: 'NOT_HOST', message: expect.any(String) });
    expect(manager.kickPlayer('p2', 'host')).toEqual({ ok: false, code: 'NOT_HOST', message: expect.any(String) });
  });

  it('host transfer: leaving host hands off to the longest-connected remaining player', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId); // joins first among the two
    manager.joinRoom('p3', 'Carol', created.roomId); // joins second

    const result = manager.leaveRoom('host');
    expect(result).toEqual({ ok: true });

    const room = manager.getRoom(created.roomId)!;
    expect(room.hostId).toBe('p2'); // longest-connected of the remainder
    const bob = room.players.find((p) => p.id === 'p2')!;
    const carol = room.players.find((p) => p.id === 'p3')!;
    expect(bob.isHost).toBe(true);
    expect(carol.isHost).toBe(false);
  });

  it('host transfer: skips a disconnected player in favor of the longest-connected one that is actually connected', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId); // joined first, but will be marked disconnected
    manager.joinRoom('p3', 'Carol', created.roomId); // joined second, but connected

    manager.setConnected('p2', false);
    manager.leaveRoom('host');

    const room = manager.getRoom(created.roomId)!;
    expect(room.hostId).toBe('p3');
  });

  it('disconnect (setConnected) marks connected:false but keeps the seat and does not transfer host', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId);

    manager.setConnected('host', false);
    const room = manager.getRoom(created.roomId)!;
    expect(room.hostId).toBe('host');
    const host = room.players.find((p) => p.id === 'host')!;
    expect(host.connected).toBe(false);
    expect(host.seat).toBe(0);
    expect(room.players).toHaveLength(2);
  });

  it('limit clamping on game change: maxPlayers is re-clamped to the new game meta bounds', () => {
    registerGame('clamp-test-small', {
      meta: { id: 'clamp-test-small', title: 'Small', minPlayers: 2, maxPlayers: 3, summary: 'test' },
      setup: () => ({}),
      reduce: (state) => ({ state, events: [] }),
      view: () => ({}),
      currentActors: () => [],
      isTerminal: () => null,
      defaultAction: () => ({}),
    });

    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8); // checkers stub bounds 2..8
    if (!created.ok) throw new Error('setup failed');
    expect(manager.getRoom(created.roomId)!.maxPlayers).toBe(8);

    const result = manager.configureRoom('host', { gameId: 'clamp-test-small' });
    expect(result).toEqual({ ok: true });
    expect(manager.getRoom(created.roomId)!.maxPlayers).toBe(3); // clamped down to the new game's max
  });

  it('limit clamping never strands already-seated players below their current count', () => {
    registerGame('clamp-test-tiny', {
      meta: { id: 'clamp-test-tiny', title: 'Tiny', minPlayers: 1, maxPlayers: 2, summary: 'test' },
      setup: () => ({}),
      reduce: (state) => ({ state, events: [] }),
      view: () => ({}),
      currentActors: () => [],
      isTerminal: () => null,
      defaultAction: () => ({}),
    });

    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId);
    manager.joinRoom('p3', 'Carol', created.roomId);
    manager.joinRoom('p4', 'Dave', created.roomId);
    expect(manager.getRoom(created.roomId)!.players).toHaveLength(4);

    manager.configureRoom('host', { gameId: 'clamp-test-tiny' });
    // Game caps at 2, but 4 are already seated — clamp floors at current count.
    expect(manager.getRoom(created.roomId)!.maxPlayers).toBe(4);
  });

  it('start: blocked below the game minimum, with a startable reason exposed on RoomState', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8); // checkers stub min 2
    if (!created.ok) throw new Error('setup failed');

    const room = manager.getRoom(created.roomId)!;
    expect(room.startable).toEqual({ ok: false, reason: 'needs 2+ players' });

    const result = manager.startRoom('host');
    expect(result).toEqual({ ok: false, code: 'BAD_PLAYER_COUNT', message: 'needs 2+ players' });
  });

  it('start: blocked when teams do not divide evenly', () => {
    registerGame('team-test-game', {
      meta: {
        id: 'team-test-game',
        title: 'Teams',
        minPlayers: 2,
        maxPlayers: 8,
        teams: { count: 2, minPerTeam: 1 },
        summary: 'test',
      },
      setup: () => ({}),
      reduce: (state) => ({ state, events: [] }),
      view: () => ({}),
      currentActors: () => [],
      isTerminal: () => null,
      defaultAction: () => ({}),
    });

    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'team-test-game', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId);
    manager.joinRoom('p3', 'Carol', created.roomId); // 3 players, 2 teams -> uneven

    const room = manager.getRoom(created.roomId)!;
    expect(room.startable).toEqual({ ok: false, reason: 'needs even teams' });
    expect(manager.startRoom('host')).toEqual({ ok: false, code: 'BAD_PLAYER_COUNT', message: 'needs even teams' });
  });

  it('start: succeeds once the minimum is met, flips phase to playing, and fires onStart listeners', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId);

    const events: Array<{ roomId: string; gameId: string }> = [];
    manager.onStart((roomId, _room, gameId) => {
      events.push({ roomId, gameId });
    });

    const result = manager.startRoom('host');
    expect(result).toEqual({ ok: true });
    expect(manager.getRoom(created.roomId)!.phase).toBe('playing');
    expect(events).toEqual([{ roomId: created.roomId, gameId: 'checkers' }]);
  });

  it('setPhase (A3 seam) moves the room back to lobby and re-broadcasts', () => {
    const { manager, transport } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId);
    manager.startRoom('host');
    expect(manager.getRoom(created.roomId)!.phase).toBe('playing');

    const before = transport.broadcasts.length;
    manager.setPhase(created.roomId, 'lobby');
    expect(manager.getRoom(created.roomId)!.phase).toBe('lobby');
    expect(transport.broadcasts.length).toBeGreaterThan(before);
  });

  it('leaveRoom deletes an emptied room', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.leaveRoom('host');
    expect(manager.getRoom(created.roomId)).toBeUndefined();
    expect(manager.getRoomOfPlayer('host')).toBeUndefined();
  });

  it('getRoomOfPlayer tracks membership across create/join/leave', () => {
    const { manager } = makeManager();
    const created = manager.createRoom('host', 'Host', 'checkers', 8);
    if (!created.ok) throw new Error('setup failed');
    manager.joinRoom('p2', 'Bob', created.roomId);
    expect(manager.getRoomOfPlayer('p2')).toBe(created.roomId);
    manager.leaveRoom('p2');
    expect(manager.getRoomOfPlayer('p2')).toBeUndefined();
  });
});
