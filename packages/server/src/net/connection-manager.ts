import type { ClientMessage, ErrorCode, PlayerId, ServerMessage } from '@party/protocol';
import type { Transport } from './transport.js';
import { WS_READY_STATE, type WebSocketLike } from './ws-like.js';
import { SessionRegistry, type Session, type SessionRegistryOptions } from './session.js';
import { RateLimiter } from './rate-limit.js';
import { parseClientMessage } from './validate.js';

export interface ConnectionManagerOptions {
  session?: SessionRegistryOptions;
  /** Per-connection token bucket. Default: 20 messages, refilling 10/sec. */
  rateLimit?: { capacity: number; refillPerSecond: number };
  /** Rejects any inbound frame larger than this many UTF-8 bytes. Default 16KiB. */
  maxMessageBytes?: number;
  /** How often to ping idle sockets to detect dead connections. Default 20s. */
  heartbeatIntervalMs?: number;
  /** Injectable clock, shared with the session registry unless overridden there. */
  now?: () => number;

  /** A validated post-hello message arrived from an established session. */
  onMessage?: (playerId: PlayerId, message: ClientMessage) => void;
  /** A session was created or reclaimed via `hello`. */
  onHello?: (playerId: PlayerId, session: Session, resumed: boolean) => void;
  /** A player's socket dropped (may still reconnect within the resume window). */
  onDisconnect?: (playerId: PlayerId) => void;
  /** A disconnected player's resume window elapsed without a reconnect. */
  onExpire?: (playerId: PlayerId) => void;
}

interface Connection {
  readonly id: string;
  socket: WebSocketLike;
  playerId: PlayerId | null;
  awaitingPong: boolean;
}

const DEFAULT_RATE_LIMIT = { capacity: 20, refillPerSecond: 10 };
const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;

function toUtf8String(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data) && data.every((chunk) => Buffer.isBuffer(chunk))) {
    return Buffer.concat(data as Buffer[]).toString('utf8');
  }
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data);
}

/**
 * Owns every live socket: framing (JSON parse + shape validation against
 * `ClientMessage`), the hello/resume session handshake, per-connection rate
 * limiting, and heartbeat liveness checks. Implements `Transport` directly —
 * it already holds the playerId -> socket mapping outbound sends need, so a
 * separate adapter class would just be indirection.
 *
 * Room/game logic is deliberately not here: everything past `hello` and
 * `ping` is handed to `onMessage` unmodified for downstream (rooms/host) to
 * interpret. This class only knows about connections, not rooms.
 */
export class ConnectionManager implements Transport {
  private readonly sessions: SessionRegistry;
  private readonly rateLimiter: RateLimiter;
  private readonly maxMessageBytes: number;
  private readonly heartbeatIntervalMs: number;
  private readonly options: ConnectionManagerOptions;

  private readonly connections = new Map<string, Connection>();
  private readonly socketsByPlayerId = new Map<PlayerId, Connection>();
  private nextConnectionId = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: ConnectionManagerOptions = {}) {
    this.options = options;
    this.sessions = new SessionRegistry(options.session);
    const rl = options.rateLimit ?? DEFAULT_RATE_LIMIT;
    this.rateLimiter = new RateLimiter({ ...rl, now: options.now });
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  /** Starts the periodic dead-socket sweep. Call once the real server is up. */
  startHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) return;
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer === undefined) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  /** Registers a freshly-accepted socket (real or fake) with the manager. */
  handleConnection(socket: WebSocketLike): void {
    const conn: Connection = { id: `c${this.nextConnectionId++}`, socket, playerId: null, awaitingPong: false };
    this.connections.set(conn.id, conn);

    socket.on('message', (data: unknown) => this.handleMessage(conn, data));
    socket.on('close', () => this.handleClose(conn));
    socket.on('pong', () => {
      conn.awaitingPong = false;
    });
    socket.on('error', () => {
      // A subsequent 'close' event does the actual cleanup; nothing to do here
      // beyond not letting an unhandled error take the process down.
    });
  }

  // ---- Transport ----------------------------------------------------

  send(playerId: PlayerId, message: ServerMessage): void {
    const conn = this.socketsByPlayerId.get(playerId);
    if (conn === undefined) return;
    this.sendToConnection(conn, message);
  }

  broadcast(playerIds: PlayerId[], message: ServerMessage): void {
    for (const playerId of playerIds) this.send(playerId, message);
  }

  disconnect(playerId: PlayerId, reason?: string): void {
    const conn = this.socketsByPlayerId.get(playerId);
    if (conn === undefined) return;
    conn.socket.close(1000, reason);
  }

  // ---- internals ------------------------------------------------------

  private sendToConnection(conn: Connection, message: ServerMessage): void {
    if (conn.socket.readyState !== WS_READY_STATE.OPEN) return;
    conn.socket.send(JSON.stringify(message));
  }

  private sendError(conn: Connection, code: ErrorCode, message: string): void {
    this.sendToConnection(conn, { t: 'error', code, message });
  }

  private handleMessage(conn: Connection, data: unknown): void {
    const raw = toUtf8String(data);

    if (Buffer.byteLength(raw, 'utf8') > this.maxMessageBytes) {
      this.sendError(conn, 'ILLEGAL_ACTION', 'message exceeds maximum size');
      return;
    }

    // Rate-limit by connection, not playerId: a socket must be limited even
    // before it has completed hello (an unauthenticated flood is still a
    // flood).
    if (!this.rateLimiter.tryConsume(conn.id)) {
      this.sendError(conn, 'RATE_LIMITED', 'too many messages, slow down');
      return;
    }

    const message = parseClientMessage(raw);
    if (message === null) {
      this.sendError(conn, 'ILLEGAL_ACTION', 'malformed or unrecognised message');
      return;
    }

    if (message.t === 'hello') {
      this.handleHello(conn, message);
      return;
    }

    if (conn.playerId === null) {
      this.sendError(conn, 'ILLEGAL_ACTION', 'must send hello before any other message');
      return;
    }

    if (message.t === 'ping') {
      this.sendToConnection(conn, { t: 'pong' });
      return;
    }

    this.options.onMessage?.(conn.playerId, message);
  }

  private handleHello(conn: Connection, message: Extract<ClientMessage, { t: 'hello' }>): void {
    let session: Session | undefined;
    let resumed = false;

    if (message.resumeToken !== undefined) {
      session = this.sessions.resume(message.resumeToken);
      resumed = session !== undefined;
    }
    if (session === undefined) {
      session = this.sessions.create(message.username);
    }

    // If this playerId already has a live socket (e.g. a stale tab
    // reconnecting after a new one took over), replace it rather than
    // leaving two sockets mapped to one identity.
    const existing = this.socketsByPlayerId.get(session.playerId);
    if (existing !== undefined && existing !== conn) {
      this.socketsByPlayerId.delete(session.playerId);
      existing.playerId = null;
      existing.socket.close(1000, 'replaced by reconnect');
    }

    conn.playerId = session.playerId;
    this.socketsByPlayerId.set(session.playerId, conn);

    this.sendToConnection(conn, { t: 'hello.ok', playerId: session.playerId, resumeToken: session.resumeToken });
    this.options.onHello?.(session.playerId, session, resumed);
  }

  private handleClose(conn: Connection): void {
    this.connections.delete(conn.id);
    this.rateLimiter.reset(conn.id);

    const playerId = conn.playerId;
    if (playerId === null) return;

    // Only clear the playerId->socket mapping if it still points at this
    // connection (it may already have been replaced by a newer reconnect).
    if (this.socketsByPlayerId.get(playerId) === conn) {
      this.socketsByPlayerId.delete(playerId);
    }
    this.sessions.markDisconnected(playerId);
    this.options.onDisconnect?.(playerId);
  }

  private heartbeatTick(): void {
    for (const conn of this.connections.values()) {
      if (conn.awaitingPong) {
        // Missed the previous ping entirely: treat as dead.
        conn.socket.terminate();
        continue;
      }
      conn.awaitingPong = true;
      conn.socket.ping();
    }

    for (const playerId of this.sessions.sweepExpired()) {
      this.options.onExpire?.(playerId);
    }
  }

  /** Test/shutdown helper: how many sockets are currently tracked. */
  get connectionCount(): number {
    return this.connections.size;
  }
}
