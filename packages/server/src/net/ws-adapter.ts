import type { WebSocket as RealWebSocket, WebSocketServer } from 'ws';
import type { WebSocketLike } from './ws-like.js';
import type { ConnectionManager } from './connection-manager.js';

/**
 * Adapts a real `ws` WebSocket to the narrow `WebSocketLike` interface the
 * net layer is written against. Kept as one small file so the only place
 * that has to know about `ws`'s real (overloaded, EventEmitter-based) types
 * is here — everything else in net/ only ever sees `WebSocketLike`.
 */
export function fromWs(socket: RealWebSocket): WebSocketLike {
  return {
    get readyState() {
      return socket.readyState;
    },
    send: (data: string) => socket.send(data),
    close: (code?: number, reason?: string) => socket.close(code, reason),
    terminate: () => socket.terminate(),
    ping: () => socket.ping(),
    // `ws`'s `on()` is a heavily overloaded EventEmitter method; casting the
    // event name is the one narrow boundary between "ws's real, overloaded
    // types" and the plain `(event, listener)` shape net/ is written
    // against everywhere else.
    on: (event, listener) => {
      socket.on(event as never, listener as never);
    },
  };
}

/**
 * Wires a real `ws` WebSocketServer's inbound connections into a
 * ConnectionManager. This is the "real class satisfying Transport, wired to
 * actual WebSocket sends/broadcasts/closes" piece — it is exported so the
 * overseer's later `packages/server/src/index.ts` integration step can call
 * it, but nothing in this package invokes it itself (net/ owns no server
 * bootstrap of its own process).
 */
export function attachToWebSocketServer(wss: WebSocketServer, manager: ConnectionManager): void {
  wss.on('connection', (socket: RealWebSocket) => {
    manager.handleConnection(fromWs(socket));
  });
}
