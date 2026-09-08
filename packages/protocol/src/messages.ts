import type { PlayerId, RoomId, GameId } from './ids.js';
import type { RoomState } from './room.js';
import type { GameEvent, GameResult } from './events.js';

export type ClientMessage =
  | { t: 'hello'; username: string; resumeToken?: string }
  | { t: 'room.create'; gameId: GameId; maxPlayers: number }
  | { t: 'room.join'; roomId: RoomId }
  | { t: 'room.leave' }
  | { t: 'room.kick'; target: PlayerId } // host only
  | { t: 'room.config'; gameId?: GameId; maxPlayers?: number } // host only
  | { t: 'room.start' } // host only
  | { t: 'game.action'; action: unknown }
  | { t: 'chat'; text: string }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'hello.ok'; playerId: PlayerId; resumeToken: string }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'room.state'; room: RoomState }
  | { t: 'game.view'; view: unknown; version: number }
  | { t: 'game.events'; events: GameEvent[]; version: number }
  | { t: 'game.over'; result: GameResult }
  | { t: 'chat'; from: PlayerId; text: string }
  | { t: 'pong' };

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_HOST'
  | 'BAD_PLAYER_COUNT'
  | 'ILLEGAL_ACTION'
  | 'NOT_YOUR_TURN'
  | 'USERNAME_TAKEN'
  | 'RATE_LIMITED'
  // Overseer addition to the frozen contract, found via A11's E2E work:
  // a kicked player previously received NO notification at all — not
  // even this — and just sat on a stale screen forever. Sent as an
  // `error` immediately before the room manager closes their connection
  // (see rooms/room-manager.ts's kickPlayer()). Purely additive to this
  // union; does not change any existing message shape.
  | 'KICKED';
