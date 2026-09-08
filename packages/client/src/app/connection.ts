import type { ClientMessage, ServerMessage } from '@party/protocol';

/**
 * Connection lifecycle, visible to the UI so it can render a status
 * indicator (see docs/ARCHITECTURE.md §1's "ui" bullet — this is exactly
 * the kind of thing the DOM overlay renders, never in-3D).
 *
 * - idle: never connected yet (before username entry).
 * - connecting: first attempt in flight.
 * - open: socket is up and `hello` has been sent.
 * - reconnecting: socket dropped and a retry is scheduled/in flight.
 * - closed: disconnected on purpose (user left) — no retry scheduled.
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

const WS_OPEN = 1;

/**
 * The subset of the browser `WebSocket` API this module depends on.
 * Deliberately narrow so tests can supply a fake without a real socket —
 * per this wave's DoD ("you don't need a real server running; use a fake/
 * mock WebSocket in your tests").
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/** Minimal storage shape (matches `Storage`) so tests can inject a fake in place of `localStorage`. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RESUME_TOKEN_KEY = 'party-games:resumeToken';
const LAST_USERNAME_KEY = 'party-games:lastUsername';

export interface ConnectionOptions {
  url: string;
  username?: string;
  wsFactory?: WebSocketFactory;
  storage?: KeyValueStorage | null;
  /** Base backoff delay in ms; doubles each attempt up to maxBackoffMs. Defaults to 500ms. */
  minBackoffMs?: number;
  /** Backoff ceiling in ms. Defaults to 10_000ms. */
  maxBackoffMs?: number;
}

type StatusListener = (status: ConnectionStatus) => void;
type MessageListener = (message: ServerMessage) => void;

/**
 * Client-side WebSocket connection: sends `ClientMessage`s, receives
 * `ServerMessage`s, and auto-reconnects with backoff, replaying the stored
 * `resumeToken` (see docs/ARCHITECTURE.md §5) on every `hello` so a dropped
 * connection reclaims the same `PlayerId`/seat/hand within the server's
 * 90-second window.
 *
 * This class only knows about the wire protocol and reconnection — it holds
 * no `RoomState`. That lives in `AppStore`, which subscribes via
 * `onMessage`.
 */
export class Connection {
  private ws: WebSocketLike | null = null;
  private status: ConnectionStatus = 'idle';
  private readonly statusListeners = new Set<StatusListener>();
  private readonly messageListeners = new Set<MessageListener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = true;
  private username: string;
  private readonly url: string;
  private readonly wsFactory: WebSocketFactory;
  private readonly storage: KeyValueStorage | null;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(opts: ConnectionOptions) {
    this.url = opts.url;
    this.username = opts.username ?? '';
    this.wsFactory = opts.wsFactory ?? defaultWsFactory;
    this.storage = opts.storage === undefined ? safeLocalStorage() : opts.storage;
    this.minBackoffMs = opts.minBackoffMs ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10_000;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Subscribes to status changes. Returns an unsubscribe function. Fires once immediately with the current status. */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  /** Subscribes to every parsed `ServerMessage`. Returns an unsubscribe function. */
  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  setUsername(username: string): void {
    this.username = username;
  }

  getStoredResumeToken(): string | undefined {
    return this.readStorage(RESUME_TOKEN_KEY);
  }

  getStoredUsername(): string | undefined {
    return this.readStorage(LAST_USERNAME_KEY);
  }

  /** Opens the socket (or re-opens after a prior `disconnect()`). Resets reconnect backoff. */
  connect(): void {
    this.closedByUser = false;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.openSocket();
  }

  /** Closes the socket and cancels any pending reconnect. No further auto-reconnect happens until `connect()` is called again. */
  disconnect(): void {
    this.closedByUser = true;
    this.clearReconnectTimer();
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }

  /** Sends a message if the socket is open; silently drops it otherwise (the caller only ever has the current RoomState to act on, so a dropped send during a reconnect is not a correctness issue — the server is the source of truth). */
  send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private openSocket(): void {
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    const ws = this.wsFactory(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('open');
      const resumeToken = this.getStoredResumeToken();
      this.writeStorage(LAST_USERNAME_KEY, this.username);
      this.send({
        t: 'hello',
        username: this.username,
        ...(resumeToken ? { resumeToken } : {}),
      });
    };

    ws.onmessage = (ev) => {
      const message = parseServerMessage(ev.data);
      if (!message) return;
      if (message.t === 'hello.ok') {
        this.writeStorage(RESUME_TOKEN_KEY, message.resumeToken);
      }
      for (const listener of this.messageListeners) listener(message);
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUser) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };

    // A close event follows an error on every WebSocket implementation this
    // targets (browsers and `ws`), so reconnect scheduling lives in
    // `onclose` only — `onerror` just exists so a broken socket never
    // throws an unhandled event into the host page.
    ws.onerror = () => {};
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const backoff = Math.min(this.maxBackoffMs, this.minBackoffMs * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => this.openSocket(), backoff);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private readStorage(key: string): string | undefined {
    try {
      return this.storage?.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private writeStorage(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Private-browsing / storage-disabled: resuming just won't work next
      // time, which degrades to a fresh `hello` — never a crash.
    }
  }
}

function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data) as ServerMessage;
  } catch {
    return null;
  }
}

function defaultWsFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

function safeLocalStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Accessing localStorage can throw (e.g. sandboxed iframe).
  }
  return null;
}
