import type { GameId, PlayerId, RoomId, RoomState, PlayerPublic, ErrorCode } from '@party/protocol';
import { generateRoomId } from '@party/protocol';
import { getGame } from '@party/engine';
import type { Transport } from '../net/transport.js';
import type { RoomManager } from './manager.js';

/**
 * Discriminated result returned by every lobby-lifecycle mutation below.
 * `net` (A1, not built yet this wave) can pattern-match on `.ok` to decide
 * whether to reply with nothing (the manager already broadcast room.state
 * itself — see "notification ownership" below) or forward `{ code,
 * message }` as a `{ t: 'error' }` ServerMessage.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional "no extra fields" default
export type RoomResult<T extends object = {}> = ({ ok: true } & T) | { ok: false; code: ErrorCode; message: string };

function fail(code: ErrorCode, message: string): { ok: false; code: ErrorCode; message: string } {
  return { ok: false, code, message };
}

/**
 * A room member as tracked internally. Extends the wire-format PlayerPublic
 * with `joinedAt`, a monotonic join-order counter used only to find the
 * "longest-connected remaining player" on host transfer — never sent to
 * clients (toPublicState strips it back down to PlayerPublic).
 */
interface InternalPlayer extends PlayerPublic {
  joinedAt: number;
}

interface InternalRoom {
  id: RoomId;
  hostId: PlayerId;
  gameId: GameId | null;
  maxPlayers: number;
  players: InternalPlayer[];
  phase: RoomState['phase'];
}

/** Fallback bounds for a gameId not present in @party/engine's registry — defensive only; a well-behaved client only ever sends ids from listGames(). */
const FALLBACK_MIN_PLAYERS = 2;
const FALLBACK_MAX_PLAYERS = 8;
const MAX_ROOM_ID_ATTEMPTS = 50;

function gameBounds(gameId: GameId | null): { min: number; max: number } {
  const meta = gameId ? getGame(gameId)?.meta : undefined;
  return meta ? { min: meta.minPlayers, max: meta.maxPlayers } : { min: FALLBACK_MIN_PLAYERS, max: FALLBACK_MAX_PLAYERS };
}

/**
 * Clamps a requested maxPlayers into the selected game's [min, max], never
 * below `floor` (typically the room's current player count, so shrinking
 * maxPlayers can never strand already-seated players).
 */
function clampMaxPlayers(gameId: GameId | null, requested: number, floor = 0): number {
  const { min, max } = gameBounds(gameId);
  const lower = Math.max(min, floor);
  const upper = Math.max(max, lower);
  return Math.min(Math.max(requested, lower), upper);
}

/**
 * Computes the `startable` field included in every RoomState, so the UI can
 * explain why the host's Start button is disabled.
 */
function computeStartable(
  gameId: GameId | null,
  players: PlayerPublic[],
  phase: RoomState['phase'],
): { ok: boolean; reason?: string } {
  if (phase !== 'lobby') {
    return { ok: false, reason: 'game already in progress' };
  }
  if (!gameId) {
    return { ok: false, reason: 'select a game' };
  }
  const meta = getGame(gameId)?.meta;
  if (!meta) {
    return { ok: false, reason: 'unknown game' };
  }
  if (players.length < meta.minPlayers) {
    return { ok: false, reason: `needs ${meta.minPlayers}+ players` };
  }
  if (players.length > meta.maxPlayers) {
    return { ok: false, reason: `too many players (max ${meta.maxPlayers})` };
  }
  if (meta.teams) {
    const { count, minPerTeam } = meta.teams;
    if (players.length % count !== 0) {
      return { ok: false, reason: 'needs even teams' };
    }
    if (players.length / count < minPerTeam) {
      return { ok: false, reason: `needs at least ${minPerTeam} players per team` };
    }
  }
  return { ok: true };
}

/** Picks the host-transfer target: the longest-connected currently-connected player, falling back to the longest-tenured player overall if nobody is currently connected. */
function pickNextHost(players: InternalPlayer[]): InternalPlayer {
  const connected = players.filter((p) => p.connected);
  const pool = connected.length > 0 ? connected : players;
  return pool.reduce((a, b) => (a.joinedAt <= b.joinedAt ? a : b));
}

/**
 * Real implementation of the RoomManager seam (packages/server/src/rooms/manager.ts),
 * plus the fuller lobby-lifecycle API (createRoom/joinRoom/etc.) that the
 * seam intentionally leaves out — see that file's docstring.
 *
 * Owns notification: every successful mutation broadcasts the fresh
 * RoomState to the room's current members via the injected Transport, so
 * `net` (A1) can call these methods directly off each ClientMessage without
 * re-deriving what to broadcast. On failure the manager does NOT send an
 * error itself — it returns `{ ok: false, code, message }` and leaves it to
 * the caller (which knows which single connection asked) to reply.
 */
export class RoomManagerImpl implements RoomManager {
  private readonly rooms = new Map<RoomId, InternalRoom>();
  private readonly playerRoom = new Map<PlayerId, RoomId>();
  private readonly startListeners: Array<(roomId: RoomId, room: RoomState, gameId: GameId) => void> = [];
  private seq = 0;

  constructor(
    private readonly transport: Transport,
    private readonly random: () => number = Math.random,
  ) {}

  // ---- RoomManager (frozen seam, consumed by A3) ----

  getRoom(roomId: RoomId): RoomState | undefined {
    const room = this.rooms.get(roomId);
    return room ? this.toPublicState(room) : undefined;
  }

  getRoomOfPlayer(playerId: PlayerId): RoomId | undefined {
    return this.playerRoom.get(playerId);
  }

  setPhase(roomId: RoomId, phase: RoomState['phase']): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.phase = phase;
    this.broadcastState(room);
  }

  onStart(cb: (roomId: RoomId, room: RoomState, gameId: GameId) => void): void {
    this.startListeners.push(cb);
  }

  // ---- Lobby lifecycle API (mine to design; net/A1 calls these off ClientMessages) ----

  /** `{ t: 'room.create' }` */
  createRoom(playerId: PlayerId, username: string, gameId: GameId, maxPlayers: number): RoomResult<{ roomId: RoomId }> {
    if (this.playerRoom.has(playerId)) {
      return fail('ILLEGAL_ACTION', 'already in a room; leave first');
    }
    const roomId = this.generateUniqueRoomId();
    if (!roomId) {
      return fail('ILLEGAL_ACTION', 'could not allocate a room code, try again');
    }
    const room: InternalRoom = {
      id: roomId,
      hostId: playerId,
      gameId,
      maxPlayers: clampMaxPlayers(gameId, maxPlayers, 1),
      phase: 'lobby',
      players: [
        { id: playerId, username, seat: 0, connected: true, isHost: true, joinedAt: this.seq++ },
      ],
    };
    this.rooms.set(roomId, room);
    this.playerRoom.set(playerId, roomId);
    this.broadcastState(room);
    return { ok: true, roomId };
  }

  /** `{ t: 'room.join' }` */
  joinRoom(playerId: PlayerId, username: string, roomId: RoomId): RoomResult<{ roomId: RoomId }> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', `no room with code ${roomId}`);
    if (this.playerRoom.has(playerId)) {
      return fail('ILLEGAL_ACTION', 'already in a room; leave first');
    }
    if (room.phase !== 'lobby') {
      return fail('ILLEGAL_ACTION', 'room is not accepting new players');
    }
    if (room.players.length >= room.maxPlayers) {
      return fail('ROOM_FULL', 'room is full');
    }
    const normalized = username.trim().toLowerCase();
    if (room.players.some((p) => p.username.trim().toLowerCase() === normalized)) {
      return fail('USERNAME_TAKEN', `"${username}" is already taken in this room`);
    }

    room.players.push({
      id: playerId,
      username,
      seat: room.players.length,
      connected: true,
      isHost: false,
      joinedAt: this.seq++,
    });
    this.playerRoom.set(playerId, roomId);
    this.broadcastState(room);
    return { ok: true, roomId };
  }

  /** `{ t: 'room.leave' }` — full, explicit removal (compacts seats, transfers host if needed). */
  leaveRoom(playerId: PlayerId): RoomResult {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return fail('ROOM_NOT_FOUND', 'not in a room');
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'not in a room');
    this.removePlayer(room, playerId);
    return { ok: true };
  }

  /**
   * Transport-level connect/disconnect marking — distinct from leaveRoom.
   * Per docs/ARCHITECTURE.md §5, a disconnected player keeps their seat
   * (shown as `connected: false`) through the 90s reconnect window; only
   * `net`'s session layer (A1, not built this wave) knows when that window
   * has elapsed, at which point it should call leaveRoom for a full evict.
   * A bare disconnect does NOT transfer host — only a full leave/kick does,
   * since a disconnected host may simply reconnect.
   */
  setConnected(playerId: PlayerId, connected: boolean): void {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    this.broadcastState(room);
  }

  /** `{ t: 'room.kick' }` — host only. */
  kickPlayer(actorId: PlayerId, targetId: PlayerId): RoomResult {
    const check = this.requireHostRoom(actorId);
    if (!check.ok) return check;
    if (targetId === actorId) {
      return fail('ILLEGAL_ACTION', 'cannot kick yourself; use leave instead');
    }
    const target = check.room.players.find((p) => p.id === targetId);
    if (!target) {
      return fail('ILLEGAL_ACTION', 'target is not in this room');
    }
    this.removePlayer(check.room, targetId);
    return { ok: true };
  }

  /** `{ t: 'room.config' }` — host only. gameId and/or maxPlayers; maxPlayers is always re-clamped to the (possibly new) game's meta bounds. */
  configureRoom(actorId: PlayerId, patch: { gameId?: GameId; maxPlayers?: number }): RoomResult {
    const check = this.requireHostRoom(actorId);
    if (!check.ok) return check;
    const room = check.room;
    if (room.phase !== 'lobby') {
      return fail('ILLEGAL_ACTION', 'cannot reconfigure a room mid-game');
    }

    if (patch.gameId !== undefined) room.gameId = patch.gameId;
    const requested = patch.maxPlayers ?? room.maxPlayers;
    room.maxPlayers = clampMaxPlayers(room.gameId, requested, room.players.length);
    this.broadcastState(room);
    return { ok: true };
  }

  /** `{ t: 'room.start' }` — host only. Moves phase to 'playing' and fires onStart listeners (A3 instantiates the host runtime from there). */
  startRoom(actorId: PlayerId): RoomResult {
    const check = this.requireHostRoom(actorId);
    if (!check.ok) return check;
    const room = check.room;
    if (room.phase !== 'lobby') {
      return fail('ILLEGAL_ACTION', 'game already in progress');
    }
    const startable = computeStartable(room.gameId, room.players, room.phase);
    if (!startable.ok) {
      return fail('BAD_PLAYER_COUNT', startable.reason ?? 'not startable');
    }

    room.phase = 'playing';
    const publicState = this.toPublicState(room);
    this.broadcastState(room, publicState);
    for (const cb of this.startListeners) cb(room.id, publicState, room.gameId as GameId);
    return { ok: true };
  }

  // ---- internals ----

  private requireHostRoom(actorId: PlayerId): { ok: true; room: InternalRoom } | { ok: false; code: ErrorCode; message: string } {
    const roomId = this.playerRoom.get(actorId);
    if (!roomId) return fail('ROOM_NOT_FOUND', 'not in a room');
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'not in a room');
    if (room.hostId !== actorId) return fail('NOT_HOST', 'only the host can do that');
    return { ok: true, room };
  }

  private generateUniqueRoomId(): RoomId | undefined {
    for (let i = 0; i < MAX_ROOM_ID_ATTEMPTS; i++) {
      const id = generateRoomId(this.random);
      if (!this.rooms.has(id)) return id;
    }
    return undefined;
  }

  /** Removes a player, compacts remaining seats to 0..n-1, transfers host if the removed player was host, deletes the room if it's now empty. Used by both leaveRoom and kickPlayer. */
  private removePlayer(room: InternalRoom, playerId: PlayerId): void {
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const wasHost = room.players[idx].isHost;
    room.players.splice(idx, 1);
    this.playerRoom.delete(playerId);
    room.players.forEach((p, i) => {
      p.seat = i;
    });

    if (room.players.length === 0) {
      this.rooms.delete(room.id);
      return;
    }

    if (wasHost) {
      const next = pickNextHost(room.players);
      room.hostId = next.id;
      room.players.forEach((p) => {
        p.isHost = p.id === next.id;
      });
    }

    this.broadcastState(room);
  }

  private toPublicState(room: InternalRoom): RoomState {
    return {
      id: room.id,
      hostId: room.hostId,
      gameId: room.gameId,
      maxPlayers: room.maxPlayers,
      players: room.players.map(({ joinedAt: _joinedAt, ...pub }) => pub),
      phase: room.phase,
      startable: computeStartable(room.gameId, room.players, room.phase),
    };
  }

  private broadcastState(room: InternalRoom, precomputed?: RoomState): void {
    if (room.players.length === 0) return;
    const state = precomputed ?? this.toPublicState(room);
    this.transport.broadcast(
      room.players.map((p) => p.id),
      { t: 'room.state', room: state },
    );
  }
}
