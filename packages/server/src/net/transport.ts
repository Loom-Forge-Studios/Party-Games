import type { PlayerId, ServerMessage } from '@party/protocol';

/**
 * The seam between the transport layer (A1: connections, framing, sessions)
 * and everything built on top of it (A2 rooms, A3 host). A1 implements a
 * real class satisfying this; A2/A3 build against the interface and can
 * supply a fake Transport in unit tests without a real WebSocket.
 *
 * Frozen for Wave 1 by the overseer (same category as packages/protocol and
 * packages/engine) specifically so A1/A2/A3 can be built in true parallel —
 * each in its own isolated git worktree, none able to see the others'
 * uncommitted work. Do not change this shape without overseer approval.
 */
export interface Transport {
  send(playerId: PlayerId, message: ServerMessage): void;
  broadcast(playerIds: PlayerId[], message: ServerMessage): void;
  disconnect(playerId: PlayerId, reason?: string): void;
}
