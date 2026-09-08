import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@party/protocol';
import { GameHost } from './game-host.js';
import { FakeRoomManager, FakeTransport, makePlayer, makeRoom, makeTrivialGame } from './fixtures.js';

function setupHost(opts: { movesToWin?: number; turnTimeoutMs?: number; seed?: number } = {}) {
  const transport = new FakeTransport();
  const roomManager = new FakeRoomManager();
  const p0 = makePlayer('p0', 0);
  const p1 = makePlayer('p1', 1);
  const room = makeRoom('ROOM', [p0, p1], 'trivial');
  roomManager.addRoom(room);
  const module = makeTrivialGame(opts.movesToWin ?? 5);

  const host = new GameHost({
    roomId: 'ROOM',
    gameId: 'trivial',
    module,
    players: [p0, p1],
    transport,
    roomManager,
    seed: opts.seed ?? 1,
    turnTimeoutMs: opts.turnTimeoutMs ?? 30_000,
    log: () => {}, // keep test output quiet
  });

  transport.clear(); // discard the initial setup fan-out so each test starts from a clean slate
  return { transport, roomManager, host, p0, p1 };
}

describe('GameHost', () => {
  it('logs the seed and fans out an initial view to every player on construction', () => {
    const transport = new FakeTransport();
    const roomManager = new FakeRoomManager();
    const p0 = makePlayer('p0', 0);
    const p1 = makePlayer('p1', 1);
    roomManager.addRoom(makeRoom('ROOM', [p0, p1], 'trivial'));
    const logs: string[] = [];

    const host = new GameHost({
      roomId: 'ROOM',
      gameId: 'trivial',
      module: makeTrivialGame(5),
      players: [p0, p1],
      transport,
      roomManager,
      seed: 42,
      log: (m) => logs.push(m),
    });

    expect(host.getVersion()).toBe(0);
    expect(logs.some((l) => l.includes('seed=42'))).toBe(true);
    expect(transport.sentTo('p0', 'game.view')).toHaveLength(1);
    expect(transport.sentTo('p1', 'game.view')).toHaveLength(1);
  });

  it('rejects an action from a player who is not a current actor (turn enforcement)', () => {
    const { transport, host } = setupHost();

    // p0 moves first (order[0] === 'p0'); p1 tries to act out of turn.
    host.handleAction('p1', { type: 'move' });

    const errors = transport.sentTo('p1', 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'NOT_YOUR_TURN' });
    expect(transport.sentTo('p1', 'game.view')).toHaveLength(0);
    expect(host.getVersion()).toBe(0); // no state transition happened
  });

  it('catches IllegalAction thrown by reduce() and reports it, without throwing to the caller', () => {
    const { transport, host } = setupHost();

    expect(() => host.handleAction('p0', { type: 'boom' })).not.toThrow();

    const errors = transport.sentTo('p0', 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'ILLEGAL_ACTION' });
    expect(host.getVersion()).toBe(0); // reduce's throw must not mutate state or bump version
    expect(transport.sentTo('p0', 'game.view')).toHaveLength(0);
  });

  it('SECURITY: a private GameEvent is never serialised into another player\'s outbound payload, not even stringified', () => {
    const { transport, host } = setupHost();

    host.handleAction('p0', { type: 'move' }); // p0 acts -> emits a public event + a private-to-p0 event

    const p0Events = transport.sentTo('p0', 'game.events');
    const p1Events = transport.sentTo('p1', 'game.events');
    expect(p0Events).toHaveLength(1);
    expect(p1Events).toHaveLength(1);

    // p0 (the entitled recipient) does see the private event.
    expect(p0Events[0]!.events.some((e) => e.type === 'secret.dealt')).toBe(true);
    // p1 (not entitled) sees only the public event.
    expect(p1Events[0]!.events).toHaveLength(1);
    expect(p1Events[0]!.events.some((e) => e.type === 'secret.dealt')).toBe(false);

    // Belt-and-suspenders: the private event's payload must not appear anywhere in what p1
    // received, in any form — not as a structured field, not stringified into some other field.
    const p0Blob = JSON.stringify(transport.sentTo('p0'));
    const p1Blob = JSON.stringify(transport.sentTo('p1'));
    const marker = extractMarker(p0Blob);
    expect(p0Blob).toContain(marker);
    expect(p1Blob).not.toContain(marker);
    expect(p1Blob).not.toContain('secret.dealt');
  });

  it('detects isTerminal(), sends game.over to every player, and returns the room to lobby', () => {
    const { transport, roomManager, host } = setupHost({ movesToWin: 1 });

    host.handleAction('p0', { type: 'move' });

    expect(host.isTerminated()).toBe(true);
    const overP0 = transport.sentTo('p0', 'game.over');
    const overP1 = transport.sentTo('p1', 'game.over');
    expect(overP0).toHaveLength(1);
    expect(overP1).toHaveLength(1);
    expect(overP0[0]!.result).toMatchObject({ winners: ['p0'], reason: 'moves exhausted' });

    expect(roomManager.phaseChanges).toContainEqual({ roomId: 'ROOM', phase: 'lobby' });

    // A terminated host refuses further actions rather than throwing.
    transport.clear();
    expect(() => host.handleAction('p1', { type: 'move' })).not.toThrow();
    expect(transport.sentTo('p1', 'error')).toHaveLength(1);
  });

  describe('turn timeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("plays defaultAction() on behalf of a player who hasn't acted once the turn timer elapses", () => {
      const { transport, host } = setupHost({ turnTimeoutMs: 1_000, movesToWin: 5 });

      vi.advanceTimersByTime(1_000);

      // The timeout applied a default 'move' for p0, advancing the turn to p1.
      expect(host.getVersion()).toBe(1);
      const p1LastView = transport.sentTo('p1', 'game.view').at(-1);
      expect((p1LastView?.view as { turn: string } | undefined)?.turn).toBe('p1');
    });

    it('cancels the pending timer once the current actor acts for real, before it fires', () => {
      const { transport, host } = setupHost({ turnTimeoutMs: 1_000, movesToWin: 5 });

      host.handleAction('p0', { type: 'move' });
      expect(host.getVersion()).toBe(1);
      transport.clear();

      // If p0's original timer were still live, this would fire a stray defaultAction for p0.
      vi.advanceTimersByTime(1_000);
      expect(host.getVersion()).toBe(2); // only p1's own (new) timer fired, exactly once
      expect(transport.sentTo('p0', 'game.view')).toHaveLength(1);
    });

    it('does not schedule further timers once the game has terminated', () => {
      const { transport, host } = setupHost({ turnTimeoutMs: 1_000, movesToWin: 1 });

      host.handleAction('p0', { type: 'move' });
      expect(host.isTerminated()).toBe(true);
      transport.clear();

      vi.advanceTimersByTime(60_000);
      expect(transport.sent).toHaveLength(0);
    });
  });
});

function extractMarker(blob: string): string {
  const match = /secret:p0:\d+/.exec(blob);
  if (!match) throw new Error('expected a secret:p0:<n> marker in p0\'s payload');
  return match[0];
}
