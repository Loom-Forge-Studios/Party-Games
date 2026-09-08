import { describe, expect, it } from 'vitest';
import type { RoomState } from '@party/protocol';
import { AppStore } from './store.js';

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    id: 'ABCD',
    hostId: 'p1',
    gameId: 'checkers',
    maxPlayers: 2,
    players: [
      { id: 'p1', username: 'host', seat: 0, connected: true, isHost: true },
      { id: 'p2', username: 'guest', seat: 1, connected: true, isHost: false },
    ],
    phase: 'lobby',
    startable: { ok: true },
    ...overrides,
  };
}

describe('AppStore', () => {
  it('starts on the username screen with no room', () => {
    const store = new AppStore();
    expect(store.getState().screen).toBe('username');
    expect(store.getState().room).toBeNull();
  });

  it('moves to the menu screen on submitUsername', () => {
    const store = new AppStore();
    store.submitUsername('alice');
    expect(store.getState().screen).toBe('menu');
    expect(store.getState().username).toBe('alice');
  });

  it('captures localPlayerId from hello.ok', () => {
    const store = new AppStore();
    store.handleServerMessage({ t: 'hello.ok', playerId: 'p1', resumeToken: 'tok' });
    expect(store.getState().localPlayerId).toBe('p1');
  });

  it('switches to the lobby screen while phase is "lobby"', () => {
    const store = new AppStore();
    store.handleServerMessage({ t: 'room.state', room: room({ phase: 'lobby' }) });
    expect(store.getState().screen).toBe('lobby');
    expect(store.getState().room?.phase).toBe('lobby');
  });

  it('switches to the table screen once phase leaves "lobby" for "playing"', () => {
    const store = new AppStore();
    store.handleServerMessage({ t: 'room.state', room: room({ phase: 'lobby' }) });
    store.handleServerMessage({ t: 'room.state', room: room({ phase: 'playing' }) });
    expect(store.getState().screen).toBe('table');
  });

  it('stays on the table screen for phase "finished"', () => {
    const store = new AppStore();
    store.handleServerMessage({ t: 'room.state', room: room({ phase: 'finished' }) });
    expect(store.getState().screen).toBe('table');
  });

  it('records the latest error from an error message', () => {
    const store = new AppStore();
    store.handleServerMessage({ t: 'error', code: 'ROOM_NOT_FOUND', message: 'no such room' });
    expect(store.getState().lastError).toEqual({ code: 'ROOM_NOT_FOUND', message: 'no such room' });
  });

  it('notifies subscribers on every change and supports unsubscribe', () => {
    const store = new AppStore();
    const seen: string[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.screen));
    expect(seen).toEqual(['username']); // fires once immediately

    store.submitUsername('bob');
    expect(seen).toEqual(['username', 'menu']);

    unsubscribe();
    store.handleServerMessage({ t: 'room.state', room: room() });
    expect(seen).toEqual(['username', 'menu']); // no further notifications
  });

  it('returnToMenu drops the room without touching connection/session state', () => {
    const store = new AppStore();
    store.handleServerMessage({ t: 'hello.ok', playerId: 'p1', resumeToken: 'tok' });
    store.setConnectionStatus('open');
    store.handleServerMessage({ t: 'room.state', room: room() });

    store.returnToMenu();

    const state = store.getState();
    expect(state.screen).toBe('menu');
    expect(state.room).toBeNull();
    expect(state.localPlayerId).toBe('p1');
    expect(state.connectionStatus).toBe('open');
  });
});
