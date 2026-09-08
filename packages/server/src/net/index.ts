// STUB ONLY — owned by A1 (Wave 1).
//
// Will hold: the ws server bootstrap, per-connection framing/parsing of
// ClientMessage / ServerMessage (@party/protocol), heartbeat (ping/pong),
// and the session/reconnect layer (resumeToken issuance + 90s reclaim
// window — see docs/ARCHITECTURE.md "Reconnect semantics").
//
// Do not build real behaviour here outside of Wave 1 — this file exists so
// the package compiles and later agents have a starting point.

export const NET_STUB = true;
