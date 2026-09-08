import type { GameId, PlayerId, RoomId, RoomState } from '@party/protocol';
import type { GameModule } from '@party/engine';
import { getGame as registryGetGame } from '@party/engine';
import type { Transport } from '../net/transport.js';
import type { RoomManager } from '../rooms/manager.js';
import { GameHost } from './game-host.js';

export interface HostManagerOptions {
  transport: Transport;
  roomManager: RoomManager;
  /** Looks up a GameModule by id. Defaults to @party/engine's registry getGame() — injectable
   *  so tests can supply a fake fixture module without depending on any real Wave 2 game. */
  getGame?: (id: GameId) => GameModule<any, any, any> | undefined;
  turnTimeoutMs?: number;
  log?: (message: string) => void;
  /**
   * Overseer addition (post-Wave-3 E2E prep): overrides GameHost's per-room
   * Rng seed, which otherwise defaults to Date.now() (see game-host.ts).
   * A fixed number seeds every room's game identically; a function is
   * called once per room.start (e.g. an incrementing counter) so E2E can
   * still exercise multiple distinct-but-reproducible games in one run.
   * Wired to the server process via the SERVER_SEED env var in
   * packages/server/src/index.ts — unset in production.
   */
  seed?: number | (() => number);
}

/**
 * Owns one GameHost per active room. Registers with the RoomManager's onStart callback (fired
 * when room.start succeeds — see packages/server/src/rooms/manager.ts) to instantiate a host
 * per room, and exposes submitAction() as the entry point for inbound `game.action` messages
 * once net's connection layer (A1) has parsed them and identified the sender.
 *
 * Wiring a real WebSocketServer's inbound messages to submitAction(), and constructing this
 * class with real Transport/RoomManager instances, is the overseer's cross-cutting integration
 * step in packages/server/src/index.ts (see docs/ARCHITECTURE.md) — not built here.
 */
export class HostManager {
  private readonly transport: Transport;
  private readonly roomManager: RoomManager;
  private readonly getGame: (id: GameId) => GameModule<any, any, any> | undefined;
  private readonly turnTimeoutMs: number | undefined;
  private readonly log: (message: string) => void;
  private readonly seedOpt: number | (() => number) | undefined;
  private readonly hosts = new Map<RoomId, GameHost>();

  constructor(opts: HostManagerOptions) {
    this.transport = opts.transport;
    this.roomManager = opts.roomManager;
    this.getGame = opts.getGame ?? registryGetGame;
    this.turnTimeoutMs = opts.turnTimeoutMs;
    this.log = opts.log ?? ((message) => console.log(message));
    this.seedOpt = opts.seed;

    this.roomManager.onStart((roomId, room, gameId) => this.startRoom(roomId, room, gameId));
  }

  /** True if `roomId` currently has an active GameHost (i.e. a game in progress). */
  hasActiveHost(roomId: RoomId): boolean {
    return this.hosts.has(roomId);
  }

  /**
   * Routes an inbound `game.action` from `playerId` into their room's active GameHost. If the
   * player isn't in a room with an active game, an `error` is sent back instead.
   */
  submitAction(playerId: PlayerId, action: unknown): void {
    const roomId = this.roomManager.getRoomOfPlayer(playerId);
    const host = roomId ? this.hosts.get(roomId) : undefined;
    if (!host) {
      this.transport.send(playerId, {
        t: 'error',
        code: 'ILLEGAL_ACTION',
        message: 'no active game for this player',
      });
      return;
    }
    host.handleAction(playerId, action);
  }

  private startRoom(roomId: RoomId, room: RoomState, gameId: GameId): void {
    const module = this.getGame(gameId);
    if (!module) {
      this.log(`[host] room ${roomId}: cannot start unknown game '${gameId}'`);
      return;
    }

    // Defensive: a stray second room.start for the same room replaces the old host outright
    // rather than leaking its timers.
    this.hosts.get(roomId)?.dispose();

    const seed = typeof this.seedOpt === 'function' ? this.seedOpt() : this.seedOpt;

    const host = new GameHost({
      roomId,
      gameId,
      module,
      players: room.players,
      transport: this.transport,
      roomManager: this.roomManager,
      turnTimeoutMs: this.turnTimeoutMs,
      log: this.log,
      ...(seed !== undefined ? { seed } : {}),
      onTerminal: () => {
        if (this.hosts.get(roomId) === host) this.hosts.delete(roomId);
      },
    });
    this.hosts.set(roomId, host);
  }
}
