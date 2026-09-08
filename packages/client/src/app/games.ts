import type { GameId } from '@party/protocol';

/**
 * TEMPORARY static fallback for the lobby's game selector.
 *
 * There is no server message to list games yet — `ClientMessage`/
 * `ServerMessage` (@party/protocol) have no "list games" pair as of this
 * wave, since A1/A2/A3 (net/rooms/host) had not merged when this package
 * was built. The real source of truth, once wired, is
 * `@party/engine`'s registry (`listGames()`), which the server should
 * expose over a new message — see docs/ARCHITECTURE.md §B.
 *
 * These three entries mirror the `GameMeta` each game package currently
 * registers (packages/games/checkers, /holdem, /codewords) so the fallback
 * list doesn't drift from what the server will eventually report. If any of
 * those `meta` blocks changes, update this file to match.
 *
 * TODO(post-merge): delete this file and the one call site that imports it
 * (packages/client/src/ui/appShell.ts) once a real "list games" round trip
 * exists, and drive the lobby's game selector from that instead.
 */
export interface GameListEntry {
  id: GameId;
  title: string;
  minPlayers: number;
  maxPlayers: number;
}

export const FALLBACK_GAMES: readonly GameListEntry[] = [
  { id: 'checkers', title: 'Checkers', minPlayers: 2, maxPlayers: 2 },
  { id: 'holdem', title: "Hold'em Poker", minPlayers: 2, maxPlayers: 8 },
  { id: 'codewords', title: 'Codewords', minPlayers: 4, maxPlayers: 8 },
];
