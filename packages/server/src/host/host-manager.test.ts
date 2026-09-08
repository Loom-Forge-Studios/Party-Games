import { describe, expect, it } from 'vitest';
import { HostManager } from './host-manager.js';
import { FakeRoomManager, FakeTransport, makePlayer, makeRoom, makeTrivialGame } from './fixtures.js';

function setup(movesToWin = 5) {
  const transport = new FakeTransport();
  const roomManager = new FakeRoomManager();
  const p0 = makePlayer('p0', 0);
  const p1 = makePlayer('p1', 1);
  roomManager.addRoom(makeRoom('ROOM', [p0, p1], 'trivial'));
  const module = makeTrivialGame(movesToWin);
  const manager = new HostManager({
    transport,
    roomManager,
    getGame: (id) => (id === 'trivial' ? module : undefined),
    log: () => {},
  });
  return { transport, roomManager, manager, p0, p1 };
}

describe('HostManager', () => {
  it('has no active host until the room manager fires onStart', () => {
    const { manager, roomManager } = setup();
    expect(manager.hasActiveHost('ROOM')).toBe(false);

    roomManager.triggerStart('ROOM', 'trivial');
    expect(manager.hasActiveHost('ROOM')).toBe(true);
  });

  it("instantiates the registry's GameModule for the room's gameId and fans out the initial view", () => {
    const { transport, roomManager } = setup();
    roomManager.triggerStart('ROOM', 'trivial');

    expect(transport.sentTo('p0', 'game.view')).toHaveLength(1);
    expect(transport.sentTo('p1', 'game.view')).toHaveLength(1);
  });

  it('does nothing (and does not throw) when room.start fires for an unregistered game id', () => {
    const { manager, roomManager } = setup();
    expect(() => roomManager.triggerStart('ROOM', 'not-a-real-game')).not.toThrow();
    expect(manager.hasActiveHost('ROOM')).toBe(false);
  });

  it("routes submitAction to the acting player's room via RoomManager.getRoomOfPlayer", () => {
    const { transport, roomManager, manager } = setup();
    roomManager.triggerStart('ROOM', 'trivial');
    transport.clear();

    manager.submitAction('p0', { type: 'move' });

    expect(transport.sentTo('p0', 'game.view')).toHaveLength(1);
    expect(transport.sentTo('p1', 'game.view')).toHaveLength(1);
  });

  it('sends an error, and does not throw, when a player with no active game submits an action', () => {
    const { transport, manager } = setup();

    expect(() => manager.submitAction('ghost', { type: 'move' })).not.toThrow();

    const errors = transport.sentTo('ghost', 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'ILLEGAL_ACTION' });
  });

  it('evicts the room from its active-host map once the game reaches a terminal state', () => {
    const { roomManager, manager } = setup(1); // one move ends the game
    roomManager.triggerStart('ROOM', 'trivial');
    expect(manager.hasActiveHost('ROOM')).toBe(true);

    manager.submitAction('p0', { type: 'move' });

    expect(manager.hasActiveHost('ROOM')).toBe(false);
    expect(roomManager.phaseChanges).toContainEqual({ roomId: 'ROOM', phase: 'lobby' });
  });
});
