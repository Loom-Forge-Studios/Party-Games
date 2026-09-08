// Owned by A2 (Wave 1).
//
// Room manager: create/join/leave/kick, room code generation
// (@party/protocol generateRoomId), RoomState (@party/protocol) bookkeeping,
// host powers (kick/config/start), player-limit clamping against the
// selected game's meta, and seat compaction.
//
// packages/server/src/index.ts (nobody's job this wave — see that file's
// comment) is where a real RoomManagerImpl gets constructed with a real
// Transport and wired to net's ClientMessage handling.

export type { RoomManager } from './manager.js';
export { RoomManagerImpl } from './room-manager.js';
export type { RoomResult } from './room-manager.js';
