// STUB ONLY — owned by A3 (Wave 1).
//
// Will hold: the game host runtime that wraps a @party/engine GameModule for
// a live room — calling setup()/reduce()/view()/currentActors()/isTerminal(),
// enforcing currentActors() before accepting a game.action, fanning out
// per-player filtered views (game.view) and event streams (game.events),
// and driving defaultAction() on turn timeout for a disconnected player.
//
// Do not build real behaviour here outside of Wave 1 — this file exists so
// the package compiles and later agents have a starting point.

export const HOST_STUB = true;
