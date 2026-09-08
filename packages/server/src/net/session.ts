import { randomUUID } from 'node:crypto';
import type { PlayerId } from '@party/protocol';

/**
 * A player's identity across the lifetime of one lobby visit. Survives a
 * dropped socket (network blip, tab reload) as long as the client reconnects
 * with `resumeToken` inside the resume window — see
 * docs/ARCHITECTURE.md "Reconnect semantics".
 */
export interface Session {
  readonly playerId: PlayerId;
  readonly username: string;
  readonly resumeToken: string;
  /** True while a live socket is associated with this session. */
  connected: boolean;
  /** Epoch ms the session went disconnected, or null while connected. */
  disconnectedAt: number | null;
}

export interface SessionRegistryOptions {
  /** How long a disconnected session stays resumable. Default 90_000ms. */
  resumeWindowMs?: number;
  /** Injectable clock for deterministic tests. Default Date.now. */
  now?: () => number;
  /** Injectable id generator for deterministic tests. Default crypto.randomUUID. */
  generateId?: () => string;
}

const DEFAULT_RESUME_WINDOW_MS = 90_000;

/**
 * In-memory session registry: `hello` -> PlayerId + resumeToken, and the
 * bookkeeping that lets a reconnecting client reclaim its identity within
 * the resume window. Pure logic, no I/O — the connection layer is the only
 * thing that touches sockets.
 */
export class SessionRegistry {
  private readonly resumeWindowMs: number;
  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly byPlayerId = new Map<PlayerId, Session>();
  private readonly byResumeToken = new Map<string, PlayerId>();

  constructor(options: SessionRegistryOptions = {}) {
    this.resumeWindowMs = options.resumeWindowMs ?? DEFAULT_RESUME_WINDOW_MS;
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
  }

  /** Creates a brand-new session (fresh `hello`, no usable resumeToken). */
  create(username: string): Session {
    const session: Session = {
      playerId: this.generateId(),
      username,
      resumeToken: this.generateId(),
      connected: true,
      disconnectedAt: null,
    };
    this.byPlayerId.set(session.playerId, session);
    this.byResumeToken.set(session.resumeToken, session.playerId);
    return session;
  }

  /**
   * Attempts to reclaim a session by its resumeToken. Returns the session
   * (now marked connected again) if the token is known and still within the
   * resume window; returns undefined otherwise (unknown token, or a session
   * that disconnected more than `resumeWindowMs` ago — which this also
   * evicts, since it can never be validly resumed again).
   */
  resume(resumeToken: string): Session | undefined {
    const playerId = this.byResumeToken.get(resumeToken);
    if (playerId === undefined) return undefined;
    const session = this.byPlayerId.get(playerId);
    if (session === undefined) {
      // Shouldn't happen (maps are kept in sync), but never trust invariants blindly.
      this.byResumeToken.delete(resumeToken);
      return undefined;
    }
    if (session.disconnectedAt !== null && this.now() - session.disconnectedAt > this.resumeWindowMs) {
      this.evict(session.playerId);
      return undefined;
    }
    session.connected = true;
    session.disconnectedAt = null;
    return session;
  }

  get(playerId: PlayerId): Session | undefined {
    return this.byPlayerId.get(playerId);
  }

  /** Marks a session's socket as gone, starting its resume-window countdown. */
  markDisconnected(playerId: PlayerId): void {
    const session = this.byPlayerId.get(playerId);
    if (session === undefined) return;
    session.connected = false;
    session.disconnectedAt = this.now();
  }

  /** Permanently removes a session (e.g. after its resume window elapses). */
  evict(playerId: PlayerId): void {
    const session = this.byPlayerId.get(playerId);
    if (session === undefined) return;
    this.byPlayerId.delete(playerId);
    this.byResumeToken.delete(session.resumeToken);
  }

  /** Evicts every session whose resume window has elapsed. Returns their ids. */
  sweepExpired(): PlayerId[] {
    const expired: PlayerId[] = [];
    for (const session of this.byPlayerId.values()) {
      if (session.disconnectedAt !== null && this.now() - session.disconnectedAt > this.resumeWindowMs) {
        expired.push(session.playerId);
      }
    }
    for (const playerId of expired) this.evict(playerId);
    return expired;
  }

  get size(): number {
    return this.byPlayerId.size;
  }
}
