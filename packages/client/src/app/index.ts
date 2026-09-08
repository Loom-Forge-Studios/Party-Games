// App bootstrap — owned by A4 (Wave 1). See docs/ARCHITECTURE.md §1: "app —
// bootstrap, WebSocket connection, lobby flow, mounting the active game's
// presenter." This wave builds everything up to the table handoff; actually
// mounting a GamePresenter into the 3D scene is A5/A6's job (and, later,
// each game's presenter) — see `onTableHandoff` below and
// packages/client/src/ui/screens/tableHandoffScreen.ts.

import type { RoomState } from '@party/protocol';
import { Connection, type ConnectionOptions } from './connection.js';
import { AppStore } from './store.js';
import { mountAppShell } from '../ui/appShell.js';

export * from './connection.js';
export * from './store.js';
export * from './games.js';

export interface BootstrapOptions {
  /** Element the DOM overlay mounts into. The 3D canvas (A5's table/) is expected to live alongside this, not inside it — the overlay sits above it via CSS (see ui/styles.ts). */
  root: HTMLElement;
  /** WebSocket URL, e.g. `wss://host/ws`. */
  serverUrl: string;
  /** Called once per lobby→table transition, with the RoomState that made it happen. Wires into A5/A6's table mount once that lands; left unset for now (see docs/ARCHITECTURE.md §6). */
  onTableHandoff?: (room: RoomState, ctx: { connection: Connection; store: AppStore }) => void;
  connectionOptions?: Partial<Omit<ConnectionOptions, 'url'>>;
}

export interface BootstrappedApp {
  connection: Connection;
  store: AppStore;
  unmount: () => void;
}

/**
 * Wires a `Connection` to an `AppStore` to the DOM overlay (`mountAppShell`)
 * and returns the pieces. This is the only function in this package that
 * assembles all three — everything it calls is independently unit-testable
 * (see connection.test.ts, store.test.ts, ui/screens/*.test.ts) without a
 * real WebSocket or a real DOM host.
 */
export function bootstrap(opts: BootstrapOptions): BootstrappedApp {
  const store = new AppStore();
  const connection = new Connection({ url: opts.serverUrl, ...opts.connectionOptions });

  const unsubscribeStatus = connection.onStatusChange((status) => store.setConnectionStatus(status));
  const unsubscribeMessages = connection.onMessage((message) => store.handleServerMessage(message));

  const unmountShell = mountAppShell({
    root: opts.root,
    store,
    connection,
    onTableHandoff: (room) => opts.onTableHandoff?.(room, { connection, store }),
  });

  return {
    connection,
    store,
    unmount: () => {
      unmountShell();
      unsubscribeStatus();
      unsubscribeMessages();
      connection.disconnect();
    },
  };
}

/** Derives the server WebSocket URL from the page's own origin (same-host `/ws`, matching docs/ARCHITECTURE.md §1's Caddy reverse-proxy setup — no separate API host). */
export function resolveServerUrl(loc: Pick<Location, 'protocol' | 'host'> = location): string {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

/** Convenience entry point for the real page (see packages/client/index.html) — resolves the server URL from `location` and bootstraps into `root`. */
export function bootstrapDefault(
  root: HTMLElement,
  onTableHandoff?: BootstrapOptions['onTableHandoff'],
): BootstrappedApp {
  return bootstrap({ root, serverUrl: resolveServerUrl(), onTableHandoff });
}
