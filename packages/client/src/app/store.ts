import type { PlayerId, RoomState, ServerMessage } from '@party/protocol';
import type { ConnectionStatus } from './connection.js';

/**
 * Which top-level screen the DOM overlay shows. This is the *only* place
 * screen-flow state lives — everything else the UI needs (am I the host,
 * is Start enabled, who's in the room) is read straight off `RoomState`
 * every render, never mirrored into a local boolean. See this wave's DoD:
 * "UI driven entirely by RoomState".
 *
 * 'table' covers both `RoomState.phase === 'playing'` and `'finished'` —
 * once a room leaves 'lobby' the DOM overlay's job is done and the 3D
 * table/presenter (A5/A6, later game presenters) takes over; a finished
 * game still shows its result on the table, not back on this lobby screen.
 */
export type Screen = 'username' | 'menu' | 'lobby' | 'table';

export interface AppState {
  screen: Screen;
  connectionStatus: ConnectionStatus;
  localPlayerId: PlayerId | null;
  username: string;
  room: RoomState | null;
  lastError: { code: string; message: string } | null;
}

export type StoreListener = (state: AppState) => void;

function initialState(prefillUsername = ''): AppState {
  return {
    screen: 'username',
    connectionStatus: 'idle',
    localPlayerId: null,
    username: prefillUsername,
    room: null,
    lastError: null,
  };
}

/**
 * Single source of truth for everything the UI renders. Screens are pure
 * functions of `AppState` (see packages/client/src/ui/screens) — nothing
 * in `ui/` keeps its own copy of server-authoritative state.
 */
export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<StoreListener>();

  constructor(prefillUsername = '') {
    this.state = initialState(prefillUsername);
  }

  getState(): AppState {
    return this.state;
  }

  /** Subscribes to every state change. Fires once immediately with the current state. Returns an unsubscribe function. */
  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  setConnectionStatus(status: ConnectionStatus): void {
    this.set({ connectionStatus: status });
  }

  setUsername(username: string): void {
    this.set({ username });
  }

  /** Advances past the username screen once a username has been chosen and `connect()` has been called. */
  submitUsername(username: string): void {
    this.set({ username, screen: 'menu', lastError: null });
  }

  clearError(): void {
    this.set({ lastError: null });
  }

  /** Feeds one parsed `ServerMessage` in. This is the only place `AppState` derives from the wire protocol. */
  handleServerMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'hello.ok':
        this.set({ localPlayerId: message.playerId, lastError: null });
        break;
      case 'room.state':
        this.set({ room: message.room, screen: screenForRoom(message.room) });
        break;
      case 'error':
        this.set({ lastError: { code: message.code, message: message.message } });
        break;
      case 'game.view':
      case 'game.events':
      case 'game.over':
      case 'chat':
      case 'pong':
        // Out of scope for this wave — mounting the game presenter and
        // rendering chat/HUD is A5/A6/game-presenter territory once a room
        // reaches 'playing'. The DOM overlay's job ends at the table
        // handoff (see docs/ARCHITECTURE.md §6).
        break;
      default:
        break;
    }
  }

  /** Returns to the menu screen and drops the current room, e.g. after leaving or being kicked. Does not touch connectionStatus or localPlayerId — the socket and session stay alive. */
  returnToMenu(): void {
    this.set({ screen: 'menu', room: null });
  }

  /** Full reset back to the username screen, e.g. on a fatal disconnect the caller decides to treat as "start over". */
  reset(prefillUsername = ''): void {
    this.state = initialState(prefillUsername);
    for (const listener of this.listeners) listener(this.state);
  }
}

function screenForRoom(room: RoomState): Screen {
  return room.phase === 'lobby' ? 'lobby' : 'table';
}
