import type { ServerMessage } from '@party/protocol';
import { WS_READY_STATE, type WebSocketLike } from '../ws-like.js';

/**
 * In-memory stand-in for a `ws.WebSocket`, used across the net/ test suite.
 * No real network socket, no real event loop I/O — just enough of the
 * WebSocketLike surface for ConnectionManager to drive, plus test-facing
 * helpers (`emitMessage`, `receivedMessages`) to script client behaviour and
 * inspect what the server sent back.
 */
export class FakeSocket implements WebSocketLike {
  readyState: number = WS_READY_STATE.OPEN;

  readonly sent: string[] = [];
  closed: { code?: number; reason?: string } | undefined;
  pingCount = 0;
  terminated = false;

  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this.closed = { code, reason };
    this.emit('close');
  }

  terminate(): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this.terminated = true;
    this.emit('close');
  }

  ping(): void {
    this.pingCount++;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  // ---- test-facing helpers ----------------------------------------------

  /** Simulates the client sending a raw (already-serialized) frame. */
  emitRaw(raw: string): void {
    this.emit('message', raw);
  }

  /** Simulates the client sending a well-formed ClientMessage-shaped object as JSON. */
  emitMessage(message: unknown): void {
    this.emitRaw(JSON.stringify(message));
  }

  /** Simulates the peer replying to a ping with a pong frame. */
  emitPong(): void {
    this.emit('pong');
  }

  /** Every ServerMessage sent to this socket so far, JSON-parsed and in order. */
  get receivedMessages(): ServerMessage[] {
    return this.sent.map((raw) => JSON.parse(raw) as ServerMessage);
  }
}
