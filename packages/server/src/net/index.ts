// A1 (Wave 1) — server transport, sessions, reconnect.
//
// Real `ws` server bootstrap (creating a `WebSocketServer` bound to a port,
// or attaching one to an `http.Server`) is intentionally NOT here: nobody in
// this wave owns wiring net+rooms+host into a running process — see
// docs/ARCHITECTURE.md and the Wave 1 brief. `attachToWebSocketServer` below
// is the piece that step will call once it exists.

export type { Transport } from './transport.js';

export type { WebSocketLike, WSEventListener } from './ws-like.js';
export { WS_READY_STATE } from './ws-like.js';

export { fromWs, attachToWebSocketServer } from './ws-adapter.js';

export type { Session, SessionRegistryOptions } from './session.js';
export { SessionRegistry } from './session.js';

export type { RateLimiterOptions } from './rate-limit.js';
export { RateLimiter } from './rate-limit.js';

export { parseClientMessage, validateClientMessage } from './validate.js';

export type { ConnectionManagerOptions } from './connection-manager.js';
export { ConnectionManager } from './connection-manager.js';
