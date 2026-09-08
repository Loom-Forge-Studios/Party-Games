// Owned by A3 (Wave 1). The game host runtime: wraps a @party/engine GameModule for a live
// room's lifetime, enforces currentActors() before accepting a game.action, fans out per-player
// filtered views (game.view) and event streams (game.events), drives defaultAction() on turn
// timeout, and detects isTerminal() to hand the room back to 'lobby'. See docs/ARCHITECTURE.md
// ("host" in §1) and game-host.ts's doc comment for the full pipeline.
//
// GameHost is the per-room engine; HostManager wires it to RoomManager.onStart and is the entry
// point (submitAction) for inbound game.action messages once net (A1) has parsed them — real
// Transport/RoomManager instances and threading net's inbound messages into submitAction() is
// the overseer's cross-cutting packages/server/src/index.ts step (deliberately not built here;
// see the top-level task brief).

export { GameHost, DEFAULT_TURN_TIMEOUT_MS } from './game-host.js';
export type { GameHostOptions } from './game-host.js';

export { HostManager } from './host-manager.js';
export type { HostManagerOptions } from './host-manager.js';
