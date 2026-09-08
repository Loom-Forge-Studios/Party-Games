import type { GameId, PlayerId, RoomId, RoomState } from '@party/protocol';

/**
 * The seam between the room manager (A2) and the game host runtime (A3).
 * A2 implements a real class satisfying this; A3 builds against the
 * interface and a fake implementation in unit tests without needing A2's
 * real code merged yet.
 *
 * Frozen for Wave 1 by the overseer for the same reason as Transport
 * (packages/server/src/net/transport.ts) — enables true parallel build.
 */
export interface RoomManager {
  getRoom(roomId: RoomId): RoomState | undefined;
  getRoomOfPlayer(playerId: PlayerId): RoomId | undefined;
  /** A3 calls this when a game reaches a terminal state, to return the room to 'lobby'. */
  setPhase(roomId: RoomId, phase: RoomState['phase']): void;
  /**
   * A2 invokes every registered callback when room.start succeeds for a
   * room, so A3 can instantiate a host runtime for it. The overseer wires
   * A2's real RoomManager to A3's real host runtime in packages/server/src/index.ts
   * after both land — this callback registration is the seam, not the wiring.
   */
  onStart(cb: (roomId: RoomId, room: RoomState, gameId: GameId) => void): void;
}
