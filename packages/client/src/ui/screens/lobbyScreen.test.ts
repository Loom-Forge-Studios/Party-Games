// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { RoomState } from '@party/protocol';
import { FALLBACK_GAMES } from '../../app/games.js';
import { renderLobbyScreen } from './lobbyScreen.js';

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    id: 'ABCD',
    hostId: 'host-1',
    gameId: 'checkers',
    maxPlayers: 2,
    players: [
      { id: 'host-1', username: 'Alice', seat: 0, connected: true, isHost: true },
      { id: 'guest-1', username: 'Bob', seat: 1, connected: true, isHost: false },
    ],
    phase: 'lobby',
    startable: { ok: true },
    ...overrides,
  };
}

function noop() {}

describe('renderLobbyScreen — host-only controls', () => {
  it('shows kick buttons, the game/player-count selectors, and an enabled Start button for the host', () => {
    const el = renderLobbyScreen({
      room: room(),
      localPlayerId: 'host-1',
      games: FALLBACK_GAMES,
      onKick: noop,
      onSelectGame: noop,
      onSetMaxPlayers: noop,
      onStart: noop,
      onLeave: noop,
    });

    // Kick button for the non-host guest, but never for the host themself.
    expect(el.querySelector('[data-testid="kick-button-guest-1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="kick-button-host-1"]')).toBeNull();

    expect(el.querySelector('[data-testid="game-select"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="max-players-select"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="game-config-readonly"]')).toBeNull();

    const startButton = el.querySelector<HTMLButtonElement>('[data-testid="start-button"]');
    expect(startButton).not.toBeNull();
    expect(startButton?.disabled).toBe(false);
    expect(el.querySelector('[data-testid="start-waiting-hint"]')).toBeNull();
  });

  it('hides every host-only control for a non-host player', () => {
    const el = renderLobbyScreen({
      room: room(),
      localPlayerId: 'guest-1',
      games: FALLBACK_GAMES,
      onKick: noop,
      onSelectGame: noop,
      onSetMaxPlayers: noop,
      onStart: noop,
      onLeave: noop,
    });

    expect(el.querySelectorAll('[data-testid^="kick-button-"]')).toHaveLength(0);
    expect(el.querySelector('[data-testid="game-select"]')).toBeNull();
    expect(el.querySelector('[data-testid="max-players-select"]')).toBeNull();
    expect(el.querySelector('[data-testid="game-config-host"]')).toBeNull();
    expect(el.querySelector('[data-testid="game-config-readonly"]')).not.toBeNull();

    expect(el.querySelector('[data-testid="start-button"]')).toBeNull();
    expect(el.querySelector('[data-testid="start-waiting-hint"]')).not.toBeNull();
  });

  it("disables Start and shows the reason from RoomState.startable when it isn't ok", () => {
    const el = renderLobbyScreen({
      room: room({ startable: { ok: false, reason: 'Need at least 2 players' } }),
      localPlayerId: 'host-1',
      games: FALLBACK_GAMES,
      onKick: noop,
      onSelectGame: noop,
      onSetMaxPlayers: noop,
      onStart: noop,
      onLeave: noop,
    });

    const startButton = el.querySelector<HTMLButtonElement>('[data-testid="start-button"]');
    expect(startButton?.disabled).toBe(true);
    expect(startButton?.title).toBe('Need at least 2 players');
    expect(el.querySelector('[data-testid="start-disabled-reason"]')?.textContent).toBe('Need at least 2 players');
  });

  it('never calls onStart when the button is disabled, even if clicked', () => {
    const onStart = vi.fn();
    const el = renderLobbyScreen({
      room: room({ startable: { ok: false, reason: 'not enough players' } }),
      localPlayerId: 'host-1',
      games: FALLBACK_GAMES,
      onKick: noop,
      onSelectGame: noop,
      onSetMaxPlayers: noop,
      onStart,
      onLeave: noop,
    });

    const startButton = el.querySelector<HTMLButtonElement>('[data-testid="start-button"]');
    startButton?.click();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('calls onKick with the target player id when the host clicks Kick', () => {
    const onKick = vi.fn();
    const el = renderLobbyScreen({
      room: room(),
      localPlayerId: 'host-1',
      games: FALLBACK_GAMES,
      onKick,
      onSelectGame: noop,
      onSetMaxPlayers: noop,
      onStart: noop,
      onLeave: noop,
    });

    el.querySelector<HTMLButtonElement>('[data-testid="kick-button-guest-1"]')?.click();
    expect(onKick).toHaveBeenCalledWith('guest-1');
  });

  it('renders the room code and player list straight from RoomState (no local mirror)', () => {
    const r = room();
    const el = renderLobbyScreen({
      room: r,
      localPlayerId: 'guest-1',
      games: FALLBACK_GAMES,
      onKick: noop,
      onSelectGame: noop,
      onSetMaxPlayers: noop,
      onStart: noop,
      onLeave: noop,
    });

    expect(el.querySelector('[data-testid="room-code"]')?.textContent).toBe('ABCD');
    expect(el.querySelectorAll('[data-testid^="player-row-"]')).toHaveLength(r.players.length);
    expect(el.querySelector('[data-testid="host-badge-host-1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="host-badge-guest-1"]')).toBeNull();
  });
});
