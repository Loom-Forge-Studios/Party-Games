import type { RoomState } from '@party/protocol';
import type { Connection } from '../app/connection.js';
import { FALLBACK_GAMES } from '../app/games.js';
import type { AppState, AppStore } from '../app/store.js';
import { renderConnectionStatus } from './connectionStatus.js';
import { clear, el } from './dom.js';
import { renderLobbyScreen } from './screens/lobbyScreen.js';
import { renderMenuScreen } from './screens/menuScreen.js';
import { renderTableHandoffScreen } from './screens/tableHandoffScreen.js';
import { renderUsernameScreen } from './screens/usernameScreen.js';
import { ensureStylesInjected } from './styles.js';

export interface AppShellOptions {
  root: HTMLElement;
  store: AppStore;
  connection: Connection;
  /** Fired once per lobby→table transition (see tableHandoffScreen.ts doc comment) — the actual mount is A5/A6's job. */
  onTableHandoff?: (room: RoomState) => void;
}

/**
 * Mounts the DOM overlay into `root` and keeps it in sync with `store`.
 * This is the composition root for `ui/` — the only place that wires
 * screens to `Connection.send` / `AppStore` mutations. Returns an unmount
 * function.
 */
export function mountAppShell(opts: AppShellOptions): () => void {
  const doc = opts.root.ownerDocument ?? document;
  ensureStylesInjected(doc);

  const statusHost = el('div', { class: 'pg-status-host' });
  const screenHost = el('main', { class: 'pg-screen-host', id: 'pg-screen-host', 'data-testid': 'screen-host' });
  const shell = el('div', { class: 'pg-app', 'data-testid': 'app-shell' }, [statusHost, screenHost]);
  opts.root.appendChild(shell);

  let wasOnTable = false;

  function render(state: AppState): void {
    clear(statusHost);
    statusHost.appendChild(renderConnectionStatus(state.connectionStatus));

    clear(screenHost);
    screenHost.appendChild(renderScreen(state, opts));
    focusFirstControl(screenHost);

    if (state.screen === 'table') {
      if (!wasOnTable && state.room) {
        opts.onTableHandoff?.(state.room);
      }
      wasOnTable = true;
    } else {
      wasOnTable = false;
    }
  }

  const unsubscribe = opts.store.subscribe(render);

  return () => {
    unsubscribe();
    opts.root.removeChild(shell);
  };
}

function renderScreen(state: AppState, opts: AppShellOptions): HTMLElement {
  switch (state.screen) {
    case 'username':
      return renderUsernameScreen({
        initialValue: state.username || opts.connection.getStoredUsername(),
        error: state.lastError ? state.lastError.message : null,
        onSubmit: (username) => {
          opts.store.submitUsername(username);
          opts.connection.setUsername(username);
          opts.connection.connect();
        },
      });

    case 'menu':
      return renderMenuScreen({
        username: state.username,
        games: FALLBACK_GAMES,
        error: state.lastError ? state.lastError.message : null,
        onCreate: (gameId, maxPlayers) => {
          opts.store.clearError();
          opts.connection.send({ t: 'room.create', gameId, maxPlayers });
        },
        onJoin: (roomId) => {
          opts.store.clearError();
          opts.connection.send({ t: 'room.join', roomId });
        },
      });

    case 'lobby':
      if (!state.room || !state.localPlayerId) {
        // room.state hasn't arrived yet for this localPlayerId — render an
        // empty screen host rather than guessing; the next store update
        // will re-render once both are present.
        return el('div', { class: 'pg-screen', 'data-testid': 'lobby-loading' });
      }
      return renderLobbyScreen({
        room: state.room,
        localPlayerId: state.localPlayerId,
        games: FALLBACK_GAMES,
        onKick: (target) => opts.connection.send({ t: 'room.kick', target }),
        onSelectGame: (gameId) => opts.connection.send({ t: 'room.config', gameId }),
        onSetMaxPlayers: (maxPlayers) => opts.connection.send({ t: 'room.config', maxPlayers }),
        onStart: () => opts.connection.send({ t: 'room.start' }),
        onLeave: () => {
          opts.connection.send({ t: 'room.leave' });
          opts.store.returnToMenu();
        },
      });

    case 'table':
      return renderTableHandoffScreen();
  }
}

function focusFirstControl(host: HTMLElement): void {
  const focusable = host.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]');
  focusable?.focus();
}
