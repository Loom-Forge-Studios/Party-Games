// Codewords rules — owned by A10 (Wave 2). A Codenames-*like* clue game,
// original in every particular: this module's own word association design,
// an originally-authored wordlist (./data/wordlist.ts), and a generic,
// non-trademarked name (see docs/ARCHITECTURE.md §7 and this package's
// index.ts header).
//
// Two teams. Each team has one spymaster, who alone can see which of the
// 25 board tiles belong to their team, the other team, are neutral, or are
// the single assassin tile. The spymaster gives a one-word clue plus a
// number; that team's guessers then reveal tiles one at a time. Revealing
// a tile makes its true colour public knowledge for everyone (that's an
// inherently public event — a physical card just got flipped over) — the
// only thing this game ever keeps secret is the *unrevealed* colour key,
// and only view() enforces that, per-viewer, on every snapshot; see
// `view()` below for why no `GameEvent.private` is needed for the key
// itself (setup() has no event channel to use one on).
//
// Rule modules must not import Three.js and must route all randomness
// through ctx.rng — never Math.random(). This file, module.test.ts, and
// determinism.test.ts all guard that invariant.

import { IllegalAction, type GameModule, type SetupCtx, type ReduceCtx, type GameEvent, type GameResult } from '@party/engine';
import type { PlayerId } from '@party/protocol';
import { WORDLIST } from './data/wordlist.js';

// ---------------------------------------------------------------------------
// Board/team shape
// ---------------------------------------------------------------------------

export const GRID_SIZE = 5;
export const BOARD_SIZE = GRID_SIZE * GRID_SIZE;

/** Standard Codenames-style card split for a 25-tile board, 9+8+7+1 = 25. */
export const STARTING_TEAM_TILES = 9;
export const OTHER_TEAM_TILES = 8;
export const NEUTRAL_TILES = 7;
export const ASSASSIN_TILES = 1;

export const MAX_CLUE_COUNT = 9;
/** A single-word clue: letters plus hyphen/apostrophe, 1-24 characters. */
const CLUE_WORD_PATTERN = /^[a-z][a-z'-]{0,23}$/i;
/** The reserved clue word `defaultAction()` plays for a disconnected/timed-out spymaster — see `count === 0` handling below. */
export const AUTO_PASS_WORD = 'pass';

export type Team = 0 | 1;
export type Role = 'spymaster' | 'guesser';
export type TileColor = 'team0' | 'team1' | 'neutral' | 'assassin';
export type Phase = 'clue' | 'guess' | 'ended';

export interface Tile {
  id: string;
  row: number;
  col: number;
  word: string;
  color: TileColor;
  revealed: boolean;
}

export interface TeamRoster {
  spymaster: PlayerId;
  guessers: PlayerId[];
}

export interface Clue {
  team: Team;
  word: string;
  count: number;
}

export interface CodewordsState {
  tiles: Tile[];
  playerTeam: Record<PlayerId, Team>;
  playerRole: Record<PlayerId, Role>;
  playerSeat: Record<PlayerId, number>;
  teams: Record<Team, TeamRoster>;
  turnTeam: Team;
  phase: Phase;
  clue: Clue | null;
  guessesRemaining: number;
  winner: Team | null;
  endReason: string | null;
}

export type CodewordsAction =
  | { type: 'clue.give'; word: string; count: number }
  | { type: 'tile.guess'; tileId: string }
  | { type: 'turn.pass' };

export interface CodewordsTileView {
  id: string;
  row: number;
  col: number;
  word: string;
  revealed: boolean;
  /** Present only when the tile is revealed, or the viewer is a spymaster. Absent, not null — see view() below. */
  color?: TileColor;
}

export interface CodewordsTeamView {
  spymasterSeat: number;
  guesserSeats: number[];
}

export interface CodewordsView {
  tiles: CodewordsTileView[];
  teams: Record<Team, CodewordsTeamView>;
  turnTeam: Team;
  phase: Phase;
  clue: Clue | null;
  guessesRemaining: number;
  /** Keyed by team number (0/1), not by TileColor string — kept structurally distinct from `color` so "how many are left" can never collide with the secret colour key in a naive substring check. */
  remaining: Record<Team, number>;
  winner: Team | null;
  endReason: string | null;
  you: { team: Team; role: Role };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function other(team: Team): Team {
  return team === 0 ? 1 : 0;
}

function teamColor(team: Team): TileColor {
  return team === 0 ? 'team0' : 'team1';
}

function countUnrevealed(tiles: Tile[], color: TileColor): number {
  return tiles.filter((t) => t.color === color && !t.revealed).length;
}

function teamMembers(state: CodewordsState, team: Team): PlayerId[] {
  const roster = state.teams[team];
  return [roster.spymaster, ...roster.guessers];
}

/** Flips the active team and returns to the clue phase. Does not itself emit an event — callers pair this with `turnEndedEvent()`. */
function endTurn(state: CodewordsState): CodewordsState {
  return {
    ...state,
    turnTeam: other(state.turnTeam),
    phase: 'clue',
    clue: null,
    guessesRemaining: 0,
  };
}

function turnEndedEvent(next: CodewordsState): GameEvent {
  const nextSpymaster = next.teams[next.turnTeam].spymaster;
  return {
    type: 'turn.ended',
    payload: { turnTeam: next.turnTeam },
    focus: { target: { kind: 'seat', seat: next.playerSeat[nextSpymaster] }, holdMs: 1600, priority: 'normal' },
  };
}

function requireActivePhase(state: CodewordsState, phase: Exclude<Phase, 'ended'>): void {
  if (state.phase === 'ended') {
    throw new IllegalAction('codewords: this game has already ended');
  }
  if (state.phase !== phase) {
    throw new IllegalAction(`codewords: this action needs phase '${phase}', game is in '${state.phase}'`);
  }
}

function buildResult(state: CodewordsState, winner: Team, reason: string): GameResult {
  const winners = teamMembers(state, winner);
  const losers = teamMembers(state, other(winner));
  const scores: Record<PlayerId, number> = {};
  for (const id of winners) scores[id] = 1;
  for (const id of losers) scores[id] = 0;
  return { winners, scores, reason };
}

// ---------------------------------------------------------------------------
// setup()
// ---------------------------------------------------------------------------

/**
 * Team/role assignment rule (concrete, documented per this wave's brief):
 * shuffle every seated player once via ctx.rng, then deal them alternately
 * team 0, team 1, team 0, ... — the room's `startable` check (this module's
 * `meta.teams = { count: 2, minPerTeam: 2 }`, enforced by
 * packages/server/src/rooms/room-manager.ts before setup() is ever called)
 * already guarantees an even player count of at least 4, so this dealing
 * always produces two exactly-equal-sized teams. Within each team, the
 * first player the shuffle lands on becomes that team's spymaster; the
 * rest are guessers. One rng.shuffle() covers both "who's on which team"
 * and "who's the spymaster" — no separate random draw needed.
 */
function assignTeams(ctx: SetupCtx): {
  playerTeam: Record<PlayerId, Team>;
  playerRole: Record<PlayerId, Role>;
  playerSeat: Record<PlayerId, number>;
  teams: Record<Team, TeamRoster>;
} {
  const shuffled = ctx.rng.shuffle(ctx.players);
  const teamLists: [PlayerId[], PlayerId[]] = [[], []];
  const playerTeam: Record<PlayerId, Team> = {};
  const playerRole: Record<PlayerId, Role> = {};
  const playerSeat: Record<PlayerId, number> = {};

  shuffled.forEach((player, i) => {
    const team: Team = (i % 2) as Team;
    const list = teamLists[team];
    list.push(player.id);
    playerTeam[player.id] = team;
    playerRole[player.id] = list.length === 1 ? 'spymaster' : 'guesser';
    playerSeat[player.id] = player.seat;
  });

  const teams: Record<Team, TeamRoster> = {
    0: { spymaster: teamLists[0][0]!, guessers: teamLists[0].slice(1) },
    1: { spymaster: teamLists[1][0]!, guessers: teamLists[1].slice(1) },
  };

  return { playerTeam, playerRole, playerSeat, teams };
}

function buildColorDeck(startingTeam: Team): TileColor[] {
  const startColor = teamColor(startingTeam);
  const otherTeamColor = teamColor(other(startingTeam));
  const deck: TileColor[] = [];
  for (let i = 0; i < STARTING_TEAM_TILES; i++) deck.push(startColor);
  for (let i = 0; i < OTHER_TEAM_TILES; i++) deck.push(otherTeamColor);
  for (let i = 0; i < NEUTRAL_TILES; i++) deck.push('neutral');
  for (let i = 0; i < ASSASSIN_TILES; i++) deck.push('assassin');
  return deck;
}

function setup(ctx: SetupCtx): CodewordsState {
  // Defensive only: packages/server/src/rooms/room-manager.ts's
  // computeStartable() already rejects an odd or <4 player count using this
  // module's meta.teams before the room manager ever calls setup() — see
  // module.test.ts's "team validation" suite for a direct test of that rule
  // (exercised here, at the setup() boundary, since this package owns no
  // server code to test it through).
  if (ctx.players.length < 4 || ctx.players.length % 2 !== 0) {
    throw new IllegalAction('codewords: needs an even number of players, at least 4 (2 balanced teams of 2+)');
  }

  const { playerTeam, playerRole, playerSeat, teams } = assignTeams(ctx);

  const words = ctx.rng.shuffle(WORDLIST.slice()).slice(0, BOARD_SIZE);
  const startingTeam: Team = ctx.rng.int(2) as Team;
  const colors = ctx.rng.shuffle(buildColorDeck(startingTeam));

  const tiles: Tile[] = words.map((word, i) => {
    const row = Math.floor(i / GRID_SIZE);
    const col = i % GRID_SIZE;
    return {
      id: `tile-${row}-${col}`,
      row,
      col,
      word,
      color: colors[i]!,
      revealed: false,
    };
  });

  return {
    tiles,
    playerTeam,
    playerRole,
    playerSeat,
    teams,
    turnTeam: startingTeam,
    phase: 'clue',
    clue: null,
    guessesRemaining: 0,
    winner: null,
    endReason: null,
  };
}

// ---------------------------------------------------------------------------
// reduce()
// ---------------------------------------------------------------------------

function handleClueGive(state: CodewordsState, action: { word: unknown; count: unknown }, ctx: ReduceCtx) {
  requireActivePhase(state, 'clue');
  const spymaster = state.teams[state.turnTeam].spymaster;
  if (ctx.actor !== spymaster) {
    throw new IllegalAction("codewords: only the active team's spymaster may give a clue");
  }

  if (typeof action.word !== 'string') {
    throw new IllegalAction('codewords: clue word must be a string');
  }
  const word = action.word.trim();
  if (!CLUE_WORD_PATTERN.test(word)) {
    throw new IllegalAction('codewords: clue must be a single word (letters, hyphen, apostrophe; 1-24 characters)');
  }
  if (state.tiles.some((t) => t.word.toLowerCase() === word.toLowerCase())) {
    throw new IllegalAction('codewords: clue may not be a word currently on the board');
  }

  if (typeof action.count !== 'number' || !Number.isInteger(action.count) || action.count < 0 || action.count > MAX_CLUE_COUNT) {
    throw new IllegalAction(`codewords: clue count must be an integer between 0 and ${MAX_CLUE_COUNT}`);
  }
  const count = action.count;

  const clueEvent: GameEvent = {
    type: 'clue.given',
    payload: { team: state.turnTeam, word, count },
    actor: ctx.actor,
    focus: { target: { kind: 'seat', seat: state.playerSeat[spymaster] }, holdMs: 2200, priority: 'normal' },
  };

  if (count === 0) {
    // A clue given with count 0 is a deliberate pass: no guesses this turn.
    // This is also exactly what defaultAction() plays on behalf of a
    // disconnected/timed-out spymaster (word: AUTO_PASS_WORD, count: 0), so
    // "the spymaster skips" needs no separate action type.
    const next = endTurn(state);
    return { state: next, events: [clueEvent, turnEndedEvent(next)] };
  }

  const next: CodewordsState = {
    ...state,
    phase: 'guess',
    clue: { team: state.turnTeam, word, count },
    guessesRemaining: count + 1,
  };
  return { state: next, events: [clueEvent] };
}

function handleTileGuess(state: CodewordsState, action: { tileId: unknown }, ctx: ReduceCtx) {
  requireActivePhase(state, 'guess');
  const team = state.turnTeam;
  if (state.playerTeam[ctx.actor] !== team || state.playerRole[ctx.actor] !== 'guesser') {
    throw new IllegalAction("codewords: only the active team's guessers may reveal a tile");
  }

  if (typeof action.tileId !== 'string') {
    throw new IllegalAction('codewords: tileId must be a string');
  }
  const idx = state.tiles.findIndex((t) => t.id === action.tileId);
  if (idx === -1) {
    throw new IllegalAction(`codewords: no such tile '${String(action.tileId)}'`);
  }
  const tile = state.tiles[idx]!;
  if (tile.revealed) {
    throw new IllegalAction(`codewords: tile '${tile.id}' has already been revealed`);
  }

  const revealed: Tile = { ...tile, revealed: true };
  const tiles = state.tiles.slice();
  tiles[idx] = revealed;

  // Revealing a tile makes its true colour public knowledge for every
  // player from this point on — a card just got physically flipped over —
  // so this event carries no `private` list, unlike the still-hidden key.
  const revealEvent: GameEvent = {
    type: 'tile.revealed',
    payload: { tileId: revealed.id, word: revealed.word, color: revealed.color, guessingTeam: team },
    actor: ctx.actor,
    focus: { target: { kind: 'object', id: revealed.id }, holdMs: 1400, priority: 'normal' },
  };

  if (revealed.color === 'assassin') {
    const winner = other(team);
    const next: CodewordsState = { ...state, tiles, phase: 'ended', winner, endReason: 'assassin' };
    const assassinEvent: GameEvent = {
      type: 'assassin.hit',
      payload: { tileId: revealed.id, losingTeam: team },
      actor: ctx.actor,
      // Long dwell — this is the game-ending moment, the camera should sit on it.
      focus: { target: { kind: 'object', id: revealed.id }, holdMs: 4500, priority: 'high' },
    };
    return { state: next, events: [revealEvent, assassinEvent] };
  }

  if (revealed.color === teamColor(team)) {
    // Correct guess: found one of the guessing team's own tiles.
    if (countUnrevealed(tiles, teamColor(team)) === 0) {
      const next: CodewordsState = { ...state, tiles, phase: 'ended', winner: team, endReason: 'all-words-found' };
      return { state: next, events: [revealEvent] };
    }
    const guessesRemaining = state.guessesRemaining - 1;
    if (guessesRemaining <= 0) {
      const next = endTurn({ ...state, tiles });
      return { state: next, events: [revealEvent, turnEndedEvent(next)] };
    }
    const next: CodewordsState = { ...state, tiles, guessesRemaining };
    return { state: next, events: [revealEvent] };
  }

  // Wrong-colour guess (neutral, or the other team's tile) — always ends
  // the turn. If it happened to be the other team's *last* hidden tile,
  // that team wins immediately (mirrors giving away the game by exposing
  // the opponent's final word).
  const opposing = other(team);
  if (revealed.color === teamColor(opposing) && countUnrevealed(tiles, teamColor(opposing)) === 0) {
    const next: CodewordsState = { ...state, tiles, phase: 'ended', winner: opposing, endReason: 'all-words-found' };
    return { state: next, events: [revealEvent] };
  }
  const next = endTurn({ ...state, tiles });
  return { state: next, events: [revealEvent, turnEndedEvent(next)] };
}

function handleTurnPass(state: CodewordsState, ctx: ReduceCtx) {
  requireActivePhase(state, 'guess');
  const team = state.turnTeam;
  if (state.playerTeam[ctx.actor] !== team || state.playerRole[ctx.actor] !== 'guesser') {
    throw new IllegalAction("codewords: only the active team's guessers may pass the turn");
  }
  const next = endTurn(state);
  return { state: next, events: [turnEndedEvent(next)] };
}

function reduce(state: CodewordsState, action: unknown, ctx: ReduceCtx) {
  if (state.phase === 'ended') {
    throw new IllegalAction('codewords: this game has already ended');
  }
  if (!action || typeof action !== 'object' || typeof (action as { type?: unknown }).type !== 'string') {
    throw new IllegalAction('codewords: malformed action');
  }
  const a = action as { type: string } & Record<string, unknown>;
  switch (a.type) {
    case 'clue.give':
      return handleClueGive(state, a as unknown as { word: unknown; count: unknown }, ctx);
    case 'tile.guess':
      return handleTileGuess(state, a as unknown as { tileId: unknown }, ctx);
    case 'turn.pass':
      return handleTurnPass(state, ctx);
    default:
      throw new IllegalAction(`codewords: unknown action type '${a.type}'`);
  }
}

// ---------------------------------------------------------------------------
// view() — the security boundary. See module.test.ts's "view filtering"
// suite for the no-substring-leak style test.
// ---------------------------------------------------------------------------

function teamView(state: CodewordsState, team: Team): CodewordsTeamView {
  const roster = state.teams[team];
  return {
    spymasterSeat: state.playerSeat[roster.spymaster]!,
    guesserSeats: roster.guessers.map((id) => state.playerSeat[id]!),
  };
}

function view(state: CodewordsState, viewer: PlayerId): CodewordsView {
  const role = state.playerRole[viewer];
  const isSpymaster = role === 'spymaster';

  const tiles: CodewordsTileView[] = state.tiles.map((t) => {
    const base: CodewordsTileView = { id: t.id, row: t.row, col: t.col, word: t.word, revealed: t.revealed };
    // The `color` field is only ever *added* when the viewer is entitled to
    // it — omitted (not null/undefined-valued), so it is genuinely absent
    // from the serialised view, not just hidden by convention. This is the
    // actual enforcement point; nothing about the presenter matters here.
    if (t.revealed || isSpymaster) {
      base.color = t.color;
    }
    return base;
  });

  return {
    tiles,
    teams: { 0: teamView(state, 0), 1: teamView(state, 1) },
    turnTeam: state.turnTeam,
    phase: state.phase,
    clue: state.clue,
    guessesRemaining: state.guessesRemaining,
    remaining: {
      0: countUnrevealed(state.tiles, 'team0'),
      1: countUnrevealed(state.tiles, 'team1'),
    },
    winner: state.winner,
    endReason: state.endReason,
    you: { team: state.playerTeam[viewer]!, role: role! },
  };
}

// ---------------------------------------------------------------------------
// currentActors / isTerminal / defaultAction
// ---------------------------------------------------------------------------

function currentActors(state: CodewordsState): PlayerId[] {
  if (state.phase === 'ended') return [];
  if (state.phase === 'clue') return [state.teams[state.turnTeam].spymaster];
  return state.teams[state.turnTeam].guessers.slice();
}

function isTerminal(state: CodewordsState): GameResult | null {
  if (state.phase !== 'ended' || state.winner === null) return null;
  const reasonText =
    state.endReason === 'assassin'
      ? `team ${state.winner} wins — the other team guessed the assassin tile`
      : `team ${state.winner} wins — found all of their words first`;
  return buildResult(state, state.winner, reasonText);
}

function defaultAction(state: CodewordsState, player: PlayerId): CodewordsAction {
  if (state.phase === 'ended') {
    throw new IllegalAction('codewords: this game has already ended');
  }
  if (state.phase === 'clue') {
    if (state.teams[state.turnTeam].spymaster !== player) {
      throw new IllegalAction(`codewords: ${player} is not the active spymaster`);
    }
    return { type: 'clue.give', word: AUTO_PASS_WORD, count: 0 };
  }
  if (!state.teams[state.turnTeam].guessers.includes(player)) {
    throw new IllegalAction(`codewords: ${player} is not a current guesser`);
  }
  return { type: 'turn.pass' };
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export const codewordsModule: GameModule<CodewordsState, CodewordsAction, CodewordsView> = {
  meta: {
    id: 'codewords',
    title: 'Codewords',
    minPlayers: 4,
    maxPlayers: 8,
    // Balance rule (concrete, per this wave's brief): teams must split the
    // room exactly in half (count: 2) with at least a spymaster + one
    // guesser per side (minPerTeam: 2) — enforced by
    // packages/server/src/rooms/room-manager.ts's computeStartable() before
    // setup() ever runs, so an uneven or <4-player start is rejected at the
    // lobby's Start button, not deep inside game logic.
    teams: { count: 2, minPerTeam: 2 },
    estMinutes: 20,
    summary: 'Team word-association clue game: give a one-word clue, guess your team\'s tiles, avoid the assassin.',
  },
  setup,
  reduce,
  view,
  currentActors,
  isTerminal,
  defaultAction,
};

export default codewordsModule;
