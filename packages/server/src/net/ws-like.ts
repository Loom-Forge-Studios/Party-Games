/**
 * The minimal subset of the `ws` package's WebSocket API that the net layer
 * actually uses. Depending on this narrow interface (instead of `ws`'s own
 * `WebSocket` type, which is a generic `EventEmitter` with many overloaded
 * `on()` signatures) means tests can supply a small in-memory fake — no real
 * socket, no real network — and get fast, deterministic unit tests for
 * handshake/resume/rate-limit behaviour.
 *
 * `net/ws-adapter.ts` adapts a real `ws.WebSocket` to this shape.
 */

/** Mirrors `ws.WebSocket`'s readyState constants (and the DOM WebSocket's). */
export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type WSEventListener = (...args: unknown[]) => void;

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** Forcibly terminate the underlying connection (no clean close handshake). */
  terminate(): void;
  /** Send a protocol-level ping frame; the peer replies with a 'pong' event. */
  ping(): void;
  /**
   * A single non-overloaded signature (rather than one overload per event
   * name) so both a real `ws.WebSocket` (via the adapter in ws-adapter.ts)
   * and a plain in-memory fake can satisfy this type structurally without
   * fighting TypeScript's method-overload variance rules. Events actually
   * used: 'message' (data: unknown), 'close' (), 'pong' (), 'error' (err: Error).
   */
  on(event: 'message' | 'close' | 'pong' | 'error', listener: (...args: unknown[]) => void): void;
}
