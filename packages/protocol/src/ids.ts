export type PlayerId = string; // stable for the session
export type RoomId = string; // 4-char join code, unambiguous alphabet (no O/0/I/1)
export type GameId = string; // 'checkers' | 'holdem' | 'codewords' | ...

/** Excludes visually-ambiguous characters O/0 and I/1. */
export const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_ID_LENGTH = 4;

/**
 * Generates a 4-char room join code from the unambiguous alphabet.
 *
 * This is a lobby/display helper, not game logic — the "all randomness flows
 * through an injected Rng" invariant applies to game modules (packages/games/*
 * and packages/engine), not this helper. Pass `random` (e.g. an engine Rng's
 * `.float()`) for deterministic/testable callers; the Math.random default is
 * fine for the server's real room-code generation.
 *
 * Does not check for collisions against active rooms — that's the caller's job.
 */
export function generateRoomId(random: () => number = Math.random): RoomId {
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += ROOM_ID_ALPHABET[Math.floor(random() * ROOM_ID_ALPHABET.length)];
  }
  return id;
}
