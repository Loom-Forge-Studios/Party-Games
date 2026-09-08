import type { RoomId, GameId, PlayerId } from './ids.js';
import type { PlayerPublic } from './player.js';

export interface RoomState {
  id: RoomId;
  hostId: PlayerId;
  gameId: GameId | null;
  maxPlayers: number;
  players: PlayerPublic[];
  phase: 'lobby' | 'playing' | 'finished';
  startable: { ok: boolean; reason?: string }; // drives the host's Start button
}
