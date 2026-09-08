// Real server bootstrap. Not owned by any single Wave 1 agent — see
// docs/ARCHITECTURE.md and each of net/index.ts, rooms/index.ts,
// host/index.ts's own header comments, which all point here. This file
// creates one real ConnectionManager (A1), one real RoomManagerImpl (A2),
// and one real HostManager (A3), and routes each parsed ClientMessage to
// the right one.
//
// Deliberately thin: every actual rule (validation, host-only checks,
// hidden-info filtering, ...) already lives in the three packages this file
// wires together. This is glue, not logic.

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { ClientMessage, PlayerId } from '@party/protocol';
import { ConnectionManager, attachToWebSocketServer } from './net/index.js';
import { RoomManagerImpl } from './rooms/index.js';
import { HostManager } from './host/index.js';

// Registers each real GameModule into @party/engine's shared registry via
// its own registerGame() side effect, overwriting the trivial Wave-1
// stubs. Each package's "." export is deliberately rules-only (no Three.js
// / @party/client) — see each game's own package.json "exports" map and
// index.ts header comment — so this is safe to import into a plain Node
// process. Nobody in Wave 2 owned this import; without it the server would
// keep running the built-in do-nothing stubs forever (see engine/src/
// registry.ts) even after real rules were merged.
import '@party/game-checkers';
import '@party/game-holdem';
import '@party/game-codewords';

const PORT = Number(process.env.PORT ?? 8080);

const httpServer = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const usernames = new Map<PlayerId, string>();

// ConnectionManager IS the Transport (see net/connection-manager.ts) — both
// RoomManagerImpl and HostManager send through this same instance.
const connectionManager: ConnectionManager = new ConnectionManager({
  onHello: (playerId, session) => {
    usernames.set(playerId, session.username);
    roomManager.setConnected(playerId, true);
  },
  onDisconnect: (playerId) => {
    roomManager.setConnected(playerId, false);
  },
  onExpire: (playerId) => {
    // The 90s resume window elapsed with no reconnect — they're not coming
    // back; a bare "still marked disconnected forever" seat would block a
    // team game from ever restarting. A full leave (not just setConnected)
    // triggers host transfer / seat compaction like any other departure.
    roomManager.leaveRoom(playerId);
    usernames.delete(playerId);
  },
  onMessage: (playerId, message) => handleMessage(playerId, message),
});

const roomManager = new RoomManagerImpl(connectionManager);
const hostManager = new HostManager({ transport: connectionManager, roomManager });

function handleMessage(playerId: PlayerId, message: ClientMessage): void {
  switch (message.t) {
    case 'room.create': {
      const username = usernames.get(playerId) ?? 'player';
      const result = roomManager.createRoom(playerId, username, message.gameId, message.maxPlayers);
      if (!result.ok) connectionManager.send(playerId, { t: 'error', code: result.code, message: result.message });
      return;
    }
    case 'room.join': {
      const username = usernames.get(playerId) ?? 'player';
      const result = roomManager.joinRoom(playerId, username, message.roomId);
      if (!result.ok) connectionManager.send(playerId, { t: 'error', code: result.code, message: result.message });
      return;
    }
    case 'room.leave': {
      const result = roomManager.leaveRoom(playerId);
      if (!result.ok) connectionManager.send(playerId, { t: 'error', code: result.code, message: result.message });
      return;
    }
    case 'room.kick': {
      const result = roomManager.kickPlayer(playerId, message.target);
      if (!result.ok) connectionManager.send(playerId, { t: 'error', code: result.code, message: result.message });
      return;
    }
    case 'room.config': {
      const result = roomManager.configureRoom(playerId, { gameId: message.gameId, maxPlayers: message.maxPlayers });
      if (!result.ok) connectionManager.send(playerId, { t: 'error', code: result.code, message: result.message });
      return;
    }
    case 'room.start': {
      const result = roomManager.startRoom(playerId);
      if (!result.ok) connectionManager.send(playerId, { t: 'error', code: result.code, message: result.message });
      return;
    }
    case 'game.action': {
      hostManager.submitAction(playerId, message.action);
      return;
    }
    case 'chat': {
      // Not owned by any Wave 1 agent; a direct room broadcast, same
      // pattern RoomManagerImpl uses internally for room.state.
      const roomId = roomManager.getRoomOfPlayer(playerId);
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      const text = message.text.slice(0, 500);
      const recipients = room.players.map((p) => p.id);
      connectionManager.broadcast(recipients, { t: 'chat', from: playerId, text });
      return;
    }
    // 'hello' and 'ping' are handled inside ConnectionManager and never
    // reach onMessage.
  }
}

attachToWebSocketServer(new WebSocketServer({ server: httpServer, path: '/ws' }), connectionManager);
connectionManager.startHeartbeat();

httpServer.listen(PORT, () => {
  console.log(`[@party/server] listening on :${PORT} (ws path: /ws, health: /healthz)`);
});

function shutdown(): void {
  connectionManager.stopHeartbeat();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
