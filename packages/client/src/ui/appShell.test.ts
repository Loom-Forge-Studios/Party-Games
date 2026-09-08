// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { RoomState, ServerMessage } from '@party/protocol';
import { Connection, type WebSocketLike } from '../app/connection.js';
import { AppStore } from '../app/store.js';
import { mountAppShell } from './appShell.js';

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    id: 'ABCD',
    hostId: 'p1',
    gameId: 'checkers',
    maxPlayers: 2,
    players: [{ id: 'p1', username: 'alice', seat: 0, connected: true, isHost: true }],
    phase: 'lobby',
    startable: { ok: true },
    ...overrides,
  };
}

class NullSocket implements WebSocketLike {
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(): void {}
  close(): void {}
}

function makeConnection(): Connection {
  return new Connection({ url: 'ws://test', storage: null, wsFactory: () => new NullSocket() });
}

describe('mountAppShell', () => {
  it('renders the username screen first, then the menu screen once a username is chosen', () => {
    const root = document.createElement('div');
    const store = new AppStore();
    const connection = makeConnection();
    mountAppShell({ root, store, connection });

    expect(root.querySelector('[data-testid="username-screen"]')).not.toBeNull();

    store.submitUsername('alice');
    expect(root.querySelector('[data-testid="menu-screen"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="username-screen"]')).toBeNull();
  });

  it('renders the lobby once room.state arrives, then the table screen once phase leaves lobby, firing onTableHandoff exactly once', () => {
    const root = document.createElement('div');
    const store = new AppStore();
    const connection = makeConnection();
    const onTableHandoff = vi.fn();
    mountAppShell({ root, store, connection, onTableHandoff });

    store.submitUsername('alice');
    store.handleServerMessage({ t: 'hello.ok', playerId: 'p1', resumeToken: 'tok' } satisfies ServerMessage);
    store.handleServerMessage({ t: 'room.state', room: room({ phase: 'lobby' }) });
    expect(root.querySelector('[data-testid="lobby-screen"]')).not.toBeNull();
    expect(onTableHandoff).not.toHaveBeenCalled();

    store.handleServerMessage({ t: 'room.state', room: room({ phase: 'playing' }) });
    expect(root.querySelector('[data-testid="table-handoff-screen"]')).not.toBeNull();
    expect(onTableHandoff).toHaveBeenCalledTimes(1);

    // A second room.state that stays on 'playing' must not re-fire the handoff.
    store.handleServerMessage({ t: 'room.state', room: room({ phase: 'playing', maxPlayers: 3 }) });
    expect(onTableHandoff).toHaveBeenCalledTimes(1);
  });

  it('always shows a visible connection status', () => {
    const root = document.createElement('div');
    const store = new AppStore();
    const connection = makeConnection();
    mountAppShell({ root, store, connection });

    const status = root.querySelector('[data-testid="connection-status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('role')).toBe('status');

    store.setConnectionStatus('reconnecting');
    expect(root.querySelector('[data-testid="connection-status"]')?.textContent).toMatch(/Reconnecting/);
  });

  it('unmount stops re-rendering on further store changes', () => {
    const root = document.createElement('div');
    const store = new AppStore();
    const connection = makeConnection();
    const unmount = mountAppShell({ root, store, connection });

    unmount();
    expect(root.querySelector('[data-testid="app-shell"]')).toBeNull();

    // Should not throw even though the shell is gone.
    expect(() => store.submitUsername('alice')).not.toThrow();
  });
});
