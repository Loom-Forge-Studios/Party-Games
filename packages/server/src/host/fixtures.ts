// Test support only — hand-rolled fakes for Transport (A1) and RoomManager (A2), plus a
// trivial 2-player GameModule fixture, so the host runtime's pipeline tests can run without any
// other agent's real implementation. Not a *.test.ts file itself (vitest's include glob is
// `**/*.test.ts`), just shared fixtures imported by game-host.test.ts / host-manager.test.ts.

import type { GameId, PlayerId, PlayerPublic, RoomId, RoomState, ServerMessage } from '@party/protocol';
import type { GameEvent, GameModule } from '@party/engine';
import { IllegalAction } from '@party/engine';
import type { Transport } from '../net/transport.js';
import type { RoomManager } from '../rooms/manager.js';

// ---------------------------------------------------------------------------
// Fake Transport (A1's real implementation doesn't exist yet)
// ---------------------------------------------------------------------------

export interface SentMessage {
  playerId: PlayerId;
  message: ServerMessage;
}

export class FakeTransport implements Transport {
  readonly sent: SentMessage[] = [];
  readonly broadcasts: { playerIds: PlayerId[]; message: ServerMessage }[] = [];
  readonly disconnected: { playerId: PlayerId; reason?: string }[] = [];

  send(playerId: PlayerId, message: ServerMessage): void {
    this.sent.push({ playerId, message });
  }

  broadcast(playerIds: PlayerId[], message: ServerMessage): void {
    this.broadcasts.push({ playerIds, message });
  }

  disconnect(playerId: PlayerId, reason?: string): void {
    this.disconnected.push({ playerId, reason });
  }

  /** All messages sent to one player, in order, optionally filtered to one `t`. */
  sentTo<T extends ServerMessage['t']>(
    playerId: PlayerId,
    t?: T,
  ): Extract<ServerMessage, { t: T }>[] {
    return this.sent
      .filter((s) => s.playerId === playerId && (!t || s.message.t === t))
      .map((s) => s.message) as Extract<ServerMessage, { t: T }>[];
  }

  clear(): void {
    this.sent.length = 0;
    this.broadcasts.length = 0;
    this.disconnected.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Fake RoomManager (A2's real implementation doesn't exist yet)
// ---------------------------------------------------------------------------

export class FakeRoomManager implements RoomManager {
  private readonly rooms = new Map<RoomId, RoomState>();
  private readonly playerRoom = new Map<PlayerId, RoomId>();
  private readonly startCbs: Array<(roomId: RoomId, room: RoomState, gameId: GameId) => void> = [];
  readonly phaseChanges: { roomId: RoomId; phase: RoomState['phase'] }[] = [];

  addRoom(room: RoomState): void {
    this.rooms.set(room.id, room);
    for (const p of room.players) this.playerRoom.set(p.id, room.id);
  }

  getRoom(roomId: RoomId): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  getRoomOfPlayer(playerId: PlayerId): RoomId | undefined {
    return this.playerRoom.get(playerId);
  }

  setPhase(roomId: RoomId, phase: RoomState['phase']): void {
    this.phaseChanges.push({ roomId, phase });
    const room = this.rooms.get(roomId);
    if (room) room.phase = phase;
  }

  onStart(cb: (roomId: RoomId, room: RoomState, gameId: GameId) => void): void {
    this.startCbs.push(cb);
  }

  /** Test helper standing in for A2 firing room.start's onStart callbacks. */
  triggerStart(roomId: RoomId, gameId: GameId): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`FakeRoomManager: no room '${roomId}'`);
    for (const cb of this.startCbs) cb(roomId, room, gameId);
  }
}

// ---------------------------------------------------------------------------
// Player / room builders
// ---------------------------------------------------------------------------

export function makePlayer(id: PlayerId, seat: number, overrides: Partial<PlayerPublic> = {}): PlayerPublic {
  return { id, username: id, seat, connected: true, isHost: seat === 0, ...overrides };
}

export function makeRoom(id: RoomId, players: PlayerPublic[], gameId: GameId): RoomState {
  return {
    id,
    hostId: players[0]!.id,
    gameId,
    maxPlayers: players.length,
    players,
    phase: 'playing',
    startable: { ok: false },
  };
}

// ---------------------------------------------------------------------------
// Trivial 2-player GameModule fixture
// ---------------------------------------------------------------------------
//
// A minimal turn-passing game used only to drive the host pipeline: each `move` action hands
// the turn to the next player, decrements a shared counter, and emits one public event plus one
// *private* event (visible only to the acting player) whose payload embeds a marker string
// unique to that player — exactly what the private-event-filtering security test needs to
// assert never leaks to anyone else, even stringified. `boom` is always illegal, to exercise
// IllegalAction handling. The game ends (isTerminal) once the counter reaches zero.

export interface TrivialState {
  order: PlayerId[];
  turn: number;
  movesLeft: number;
  over: boolean;
  secrets: Record<PlayerId, number>;
}

export type TrivialAction = { type: 'move' } | { type: 'boom' };

export interface TrivialView {
  turn: PlayerId;
  movesLeft: number;
  over: boolean;
  yourSecret: number;
}

/** The private event payload's marker string for one player's dealt secret, e.g. "secret:p0:417". */
export function secretMarker(playerId: PlayerId, secret: number): string {
  return `secret:${playerId}:${secret}`;
}

export function makeTrivialGame(movesToWin = 2): GameModule<TrivialState, TrivialAction, TrivialView> {
  return {
    meta: {
      id: 'trivial' as GameId,
      title: 'Trivial Test Game',
      minPlayers: 2,
      maxPlayers: 2,
      summary: 'fixture game for host runtime tests only — never registered for real play',
    },
    setup(ctx) {
      const order = ctx.players.map((p) => p.id);
      const secrets: Record<PlayerId, number> = {};
      for (const id of order) secrets[id] = ctx.rng.int(1000);
      return { order, turn: 0, movesLeft: movesToWin, over: false, secrets };
    },
    reduce(state, action, ctx) {
      if (state.over) throw new IllegalAction('trivial: game already over');
      if (action.type === 'boom') throw new IllegalAction('trivial: boom is always illegal');

      const movesLeft = state.movesLeft - 1;
      const over = movesLeft <= 0;
      const next: TrivialState = {
        ...state,
        turn: (state.turn + 1) % state.order.length,
        movesLeft,
        over,
      };

      const events: GameEvent[] = [
        { type: 'moved', payload: { by: ctx.actor }, actor: ctx.actor },
        {
          type: 'secret.dealt',
          payload: { marker: secretMarker(ctx.actor, state.secrets[ctx.actor]!) },
          actor: ctx.actor,
          private: [ctx.actor],
        },
      ];
      return { state: next, events };
    },
    view(state, viewer) {
      return {
        turn: state.order[state.turn]!,
        movesLeft: state.movesLeft,
        over: state.over,
        yourSecret: state.secrets[viewer] ?? -1,
      };
    },
    currentActors(state) {
      return state.over ? [] : [state.order[state.turn]!];
    },
    isTerminal(state) {
      return state.over ? { winners: [state.order[0]!], reason: 'moves exhausted' } : null;
    },
    defaultAction() {
      return { type: 'move' };
    },
  };
}
