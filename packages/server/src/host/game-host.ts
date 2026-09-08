import type { GameId, PlayerId, PlayerPublic, RoomId, RoomState, ServerMessage } from '@party/protocol';
import type { GameEvent, GameModule, ReduceResult } from '@party/engine';
import { IllegalAction, createRng, type Rng } from '@party/engine';
import type { Transport } from '../net/transport.js';
import type { RoomManager } from '../rooms/manager.js';

/** Default time a current actor gets to act before defaultAction() is played on their behalf. */
export const DEFAULT_TURN_TIMEOUT_MS = 30_000;

export interface GameHostOptions {
  roomId: RoomId;
  gameId: GameId;
  module: GameModule<any, any, any>;
  /** The room's players at game.start (RoomState.players — includes seat/connected/isHost). */
  players: PlayerPublic[];
  transport: Transport;
  roomManager: RoomManager;
  /** Rng seed for this room's game instance. Defaults to Date.now() — this is host wiring,
   *  not a game rule module, so the "no Math.random()" determinism invariant (which is scoped
   *  to packages/games/* and packages/engine) doesn't apply here, but a caller-supplied seed
   *  (e.g. for tests/replays) is always honoured when given. */
  seed?: number;
  turnTimeoutMs?: number;
  /** Structured-ish logger hook; defaults to console.log. Seed is always logged for
   *  reproducibility of bug reports. */
  log?: (message: string) => void;
  /** Invoked once, after this host has finished handling a terminal state (game.over sent to
   *  every player, room phase already set back to 'lobby'). Lets an owning HostManager evict
   *  this instance from its room map. */
  onTerminal?: () => void;
}

/**
 * The game host runtime for a single active room (§ "host" in docs/ARCHITECTURE.md). One
 * instance wraps one @party/engine GameModule for the room's lifetime:
 *
 *  - owns the authoritative game state and a seeded Rng for this room's game instance
 *  - the action pipeline: currentActors() gate -> reduce() -> catch IllegalAction -> version++
 *    -> per-player filtered view + filtered events fan-out
 *  - turn timeouts: defaultAction() played on behalf of a current actor who hasn't acted
 *  - terminal detection: game.over fan-out + notifying the RoomManager back to 'lobby'
 *
 * The event filter (fanOut, below) is a security boundary: a GameEvent with a `private` array
 * must never be serialised into another player's outbound payload. See game-host.test.ts.
 */
export class GameHost {
  readonly roomId: RoomId;
  readonly gameId: GameId;

  private readonly module: GameModule<any, any, any>;
  private readonly transport: Transport;
  private readonly roomManager: RoomManager;
  private readonly players: PlayerPublic[];
  private readonly rng: Rng;
  private readonly seed: number;
  private readonly turnTimeoutMs: number;
  private readonly log: (message: string) => void;
  private readonly onTerminal?: () => void;

  private state: unknown;
  private version = 0;
  private terminated = false;
  private readonly timers = new Map<PlayerId, ReturnType<typeof setTimeout>>();

  constructor(opts: GameHostOptions) {
    this.roomId = opts.roomId;
    this.gameId = opts.gameId;
    this.module = opts.module;
    this.transport = opts.transport;
    this.roomManager = opts.roomManager;
    this.players = opts.players;
    this.turnTimeoutMs = opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.log = opts.log ?? ((message) => console.log(message));
    this.onTerminal = opts.onTerminal;

    this.seed = opts.seed ?? Date.now();
    this.rng = createRng(this.seed);
    this.log(
      `[host] room ${this.roomId}: starting '${this.gameId}' for ${this.players.length} player(s), seed=${this.seed}`,
    );

    this.state = this.module.setup({ players: this.players, rng: this.rng });
    this.fanOut([]);
    this.syncTimers();
    this.checkTerminal();
  }

  /** Current view/events version stamp — monotonically increasing per room, per docs/ARCHITECTURE.md §3. */
  getVersion(): number {
    return this.version;
  }

  /** True once isTerminal(state) has fired and game.over has been sent. No further actions are accepted. */
  isTerminated(): boolean {
    return this.terminated;
  }

  /**
   * Entry point for an inbound `game.action`: validate the sender is a current actor, run it
   * through reduce(), and fan out the result. IllegalAction from reduce() is caught here and
   * reported to the sender as an `error` message — it never propagates out of this method.
   */
  handleAction(playerId: PlayerId, action: unknown): void {
    if (this.terminated) {
      this.sendError(playerId, 'ILLEGAL_ACTION', 'this game has already ended');
      return;
    }
    const actors = this.module.currentActors(this.state);
    if (!actors.includes(playerId)) {
      this.sendError(playerId, 'NOT_YOUR_TURN', 'it is not your turn');
      return;
    }
    this.applyAction(playerId, action);
  }

  /** Clears any pending turn timers. Call when discarding a host outside the normal terminal path. */
  dispose(): void {
    this.clearAllTimers();
  }

  private applyAction(playerId: PlayerId, action: unknown): void {
    let result: ReduceResult<unknown>;
    try {
      result = this.module.reduce(this.state, action, { actor: playerId, rng: this.rng });
    } catch (err) {
      if (err instanceof IllegalAction) {
        this.sendError(playerId, 'ILLEGAL_ACTION', err.message);
        // The actor may still be current (e.g. a rejected move) — make sure their turn timer
        // is still running rather than silently lapsed, without disturbing anyone else's.
        this.syncTimers();
        return;
      }
      throw err;
    }

    this.state = result.state;
    this.version += 1;
    this.fanOut(result.events);
    this.syncTimers();
    this.checkTerminal();
  }

  /**
   * Sends every connected player their own filtered view + filtered event stream for the
   * current state/version. This is the security boundary: an event is included in a player's
   * outbound `game.events` payload only if it has no `private` list, or that list includes them.
   */
  private fanOut(events: GameEvent[]): void {
    for (const player of this.players) {
      const view = this.module.view(this.state, player.id);
      this.send(player.id, { t: 'game.view', view, version: this.version });

      const visible = events.filter((ev) => !ev.private || ev.private.includes(player.id));
      this.send(player.id, { t: 'game.events', events: visible, version: this.version });
    }
  }

  private checkTerminal(): void {
    if (this.terminated) return;
    const result = this.module.isTerminal(this.state);
    if (!result) return;

    this.terminated = true;
    this.clearAllTimers();
    for (const player of this.players) {
      this.send(player.id, { t: 'game.over', result });
    }
    this.roomManager.setPhase(this.roomId, 'lobby' satisfies RoomState['phase']);
    this.log(`[host] room ${this.roomId}: '${this.gameId}' over — ${result.reason}`);
    this.onTerminal?.();
  }

  /** Reconciles pending turn timers against the current currentActors(state): clears timers for
   *  players no longer current, starts one for any newly-current player who doesn't have one. */
  private syncTimers(): void {
    if (this.terminated) return;
    const actors = new Set<PlayerId>(this.module.currentActors(this.state));

    for (const [playerId, timer] of this.timers) {
      if (!actors.has(playerId)) {
        clearTimeout(timer);
        this.timers.delete(playerId);
      }
    }
    for (const playerId of actors) {
      if (!this.timers.has(playerId)) {
        const timer = setTimeout(() => this.onTurnTimeout(playerId), this.turnTimeoutMs);
        this.timers.set(playerId, timer);
      }
    }
  }

  private onTurnTimeout(playerId: PlayerId): void {
    this.timers.delete(playerId);
    if (this.terminated) return;
    // Stale timer guard: the turn may have already moved on for other reasons between
    // scheduling and firing.
    if (!this.module.currentActors(this.state).includes(playerId)) return;

    this.log(`[host] room ${this.roomId}: turn timeout for ${playerId}, applying defaultAction`);
    const action = this.module.defaultAction(this.state, playerId);
    this.applyAction(playerId, action);
  }

  private clearAllTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private sendError(playerId: PlayerId, code: Extract<ServerMessage, { t: 'error' }>['code'], message: string): void {
    this.send(playerId, { t: 'error', code, message });
  }

  private send(playerId: PlayerId, message: ServerMessage): void {
    this.transport.send(playerId, message);
  }
}
