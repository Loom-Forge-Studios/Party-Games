// The real Checkers GameModule — owned by A8. See docs/ARCHITECTURE.md §4/§7:
// this file must never import Three.js or @party/client, and all randomness
// (there is none needed here — see the header note below) must flow through
// the injected Rng, never Math.random(). index.ts is the only file that
// calls registerGame() with this module.

import type { PlayerId } from '@party/protocol';
import {
  IllegalAction,
  type FocusHint,
  type GameEvent,
  type GameModule,
  type GameResult,
  type ReduceCtx,
  type ReduceResult,
  type SetupCtx,
} from '@party/engine';
import * as B from './board.js';
import { squareToWorld } from './layout.js';

// ---------------------------------------------------------------------------
// State / action / view shapes
// ---------------------------------------------------------------------------

export interface CheckersOptions {
  /** If true (the default), a player who has any legal capture available anywhere on the board must play a capturing move that turn — a non-capturing move is illegal. */
  forcedCapture?: boolean;
  /** Plies (individual reduce() calls, i.e. one hop) without either side completing a capture before the game is declared a draw. See DEFAULT_DRAW_PLY_LIMIT. */
  drawPlyLimit?: number;
}

/** Forced-capture defaults ON per the brief. */
export const DEFAULT_FORCED_CAPTURE = true;

/**
 * "Draw after 40 moves with no capture" (the brief's wording) is implemented
 * as 40 plies — 40 individual reduce() calls, i.e. up to 20 turns per side —
 * with no capture by either player, reset to 0 the instant any capture
 * happens (including mid multi-jump-chain hops). This is the usual reading
 * of a "N-move no-capture draw" rule in turn-based games (compare chess's
 * 50-move rule, which also counts individual half-moves/plies, not full
 * round trips). Configurable via CheckersOptions.drawPlyLimit for the setup
 * screen / tests.
 */
export const DEFAULT_DRAW_PLY_LIMIT = 40;

/** Camera holds a bit longer on a promotion than an ordinary move/capture — it's the highlight moment per the brief. */
export const CROWNED_HOLD_MS = 2200;
/** Wide table shot at game end gets a generous hold so the result is legible. */
export const GAME_OVER_HOLD_MS = 3000;

export interface CheckersPieceView {
  id: string;
  owner: B.Seat;
  king: boolean;
}

export interface CheckersState {
  board: Array<B.Piece | null>;
  /** Index === seat number, per docs/ARCHITECTURE.md §1/§6 convention — seats[0] is seat 0's player id, seats[1] is seat 1's. */
  seats: [PlayerId, PlayerId];
  /** Whose turn it is. */
  turn: PlayerId;
  /** Square of the piece mid-multi-jump that must keep capturing this turn; null when the mover is free to choose any piece. */
  activeChain: number | null;
  plysSinceCapture: number;
  forcedCapture: boolean;
  drawPlyLimit: number;
}

export interface CheckersMoveAction {
  type: 'move';
  from: number;
  to: number;
}

export type CheckersAction = CheckersMoveAction;

/** GameEvent payload shapes this module emits — shared with presenter.ts (type-only import, so it doesn't pull Three.js into this file) so the two never disagree about event payload fields. */
export interface PieceMovedPayload {
  pieceId: string;
  owner: B.Seat;
  from: number;
  to: number;
  king: boolean;
}
export interface PieceCapturedPayload {
  pieceId: string;
  owner: B.Seat;
  square: number;
}
export interface PieceCrownedPayload {
  pieceId: string;
  owner: B.Seat;
  square: number;
}
export interface GameOverPayload {
  result: GameResult;
}

export interface CheckersView {
  board: Array<CheckersPieceView | null>;
  seats: [PlayerId, PlayerId];
  turn: PlayerId;
  activeChain: number | null;
  plysSinceCapture: number;
  forcedCapture: boolean;
  drawPlyLimit: number;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function seatIndexOfPlayer(state: CheckersState, player: PlayerId): B.Seat {
  if (state.seats[0] === player) return 0;
  if (state.seats[1] === player) return 1;
  throw new IllegalAction(`checkers: "${player}" is not seated in this game`);
}

function otherSeat(seat: B.Seat): B.Seat {
  return seat === 0 ? 1 : 0;
}

function pointFocus(square: number, extra: Partial<Omit<FocusHint, 'target'>> = {}): FocusHint {
  const p = squareToWorld(square);
  return { target: { kind: 'point', x: p.x, y: p.y, z: p.z }, ...extra };
}

function parseMoveAction(action: unknown): { from: number; to: number } {
  if (typeof action !== 'object' || action === null) {
    throw new IllegalAction('checkers: malformed action — expected { type: "move", from, to }');
  }
  const a = action as Record<string, unknown>;
  if (a.type !== 'move' || typeof a.from !== 'number' || typeof a.to !== 'number') {
    throw new IllegalAction('checkers: malformed action — expected { type: "move", from, to }');
  }
  if (!B.isPlayableSquare(a.from) || !B.isPlayableSquare(a.to)) {
    throw new IllegalAction(`checkers: invalid square in move (${a.from} -> ${a.to})`);
  }
  return { from: a.from, to: a.to };
}

/** Shared by the exported isTerminal() and reduce()'s own game.over event decision — must never diverge from each other. */
function computeResult(state: CheckersState): GameResult | null {
  if (state.plysSinceCapture >= state.drawPlyLimit) {
    return { winners: [], reason: `draw: ${state.drawPlyLimit} plies passed with no capture` };
  }

  const moverSeat = seatIndexOfPlayer(state, state.turn);
  const opponentSeat = otherSeat(moverSeat);
  const opponentId = state.seats[opponentSeat];

  if (B.ownerPieceCount(state.board, moverSeat) === 0) {
    return { winners: [opponentId], reason: `${state.turn} has no pieces remaining` };
  }
  if (!B.ownerHasAnyMove(state.board, moverSeat)) {
    return { winners: [opponentId], reason: `${state.turn} has no legal moves` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// GameModule
// ---------------------------------------------------------------------------

function setup(ctx: SetupCtx): CheckersState {
  const bySeat = [...ctx.players].sort((a, b) => a.seat - b.seat);
  if (bySeat.length !== 2 || bySeat[0]!.seat !== 0 || bySeat[1]!.seat !== 1) {
    throw new IllegalAction('checkers: requires exactly 2 seated players (seats 0 and 1)');
  }

  const options = (ctx.options ?? {}) as CheckersOptions;
  const seats: [PlayerId, PlayerId] = [bySeat[0]!.id, bySeat[1]!.id];

  return {
    board: B.initialBoard(),
    seats,
    turn: seats[0],
    activeChain: null,
    plysSinceCapture: 0,
    forcedCapture: options.forcedCapture ?? DEFAULT_FORCED_CAPTURE,
    drawPlyLimit: options.drawPlyLimit ?? DEFAULT_DRAW_PLY_LIMIT,
  };
}

function reduce(state: CheckersState, action: CheckersAction, ctx: ReduceCtx): ReduceResult<CheckersState> {
  if (computeResult(state)) {
    throw new IllegalAction('checkers: the game is already over');
  }
  if (ctx.actor !== state.turn) {
    throw new IllegalAction(`checkers: it is not ${ctx.actor}'s turn`);
  }

  const { from, to } = parseMoveAction(action);
  const owner = seatIndexOfPlayer(state, ctx.actor);
  const piece = state.board[from];
  if (!piece) throw new IllegalAction(`checkers: no piece at square ${from}`);
  if (piece.owner !== owner) throw new IllegalAction('checkers: cannot move an opponent\'s piece');

  const isChainContinuation = state.activeChain !== null;
  if (isChainContinuation && from !== state.activeChain) {
    throw new IllegalAction('checkers: must continue capturing with the same piece');
  }

  const captureMoves = B.captureMovesFrom(state.board, from);
  const chosenCapture = captureMoves.find((m) => m.to === to);
  const forcedCaptureActive = !isChainContinuation && state.forcedCapture && B.ownerHasAnyCapture(state.board, owner);

  let move: B.Move | undefined = chosenCapture;
  if (!move && !isChainContinuation && !forcedCaptureActive) {
    move = B.simpleMovesFrom(state.board, from).find((m) => m.to === to);
  }

  if (!move) {
    if (isChainContinuation) throw new IllegalAction('checkers: must continue capturing with the same piece');
    if (forcedCaptureActive) throw new IllegalAction('checkers: a capture is available and must be taken');
    throw new IllegalAction(`checkers: illegal move from ${from} to ${to}`);
  }

  const board = state.board.slice();
  const capturedPiece = move.kind === 'capture' ? board[move.captured] : null;

  board[move.from] = null;
  if (move.kind === 'capture') board[move.captured] = null;

  const { row: toRow } = B.squareToRowCol(move.to);
  const promoted = !piece.king && B.isBackRow(piece.owner, toRow);
  const movedPiece: B.Piece = promoted ? { ...piece, king: true } : piece;
  board[move.to] = movedPiece;

  const movedPayload = {
    pieceId: movedPiece.id,
    owner: movedPiece.owner,
    from: move.from,
    to: move.to,
    king: movedPiece.king,
  } satisfies PieceMovedPayload;

  const events: GameEvent[] = [
    { type: 'piece.moved', payload: movedPayload, actor: ctx.actor, focus: pointFocus(move.to) },
  ];

  if (move.kind === 'capture' && capturedPiece) {
    const capturedPayload = {
      pieceId: capturedPiece.id,
      owner: capturedPiece.owner,
      square: move.captured,
    } satisfies PieceCapturedPayload;
    events.push({ type: 'piece.captured', payload: capturedPayload, actor: ctx.actor, focus: pointFocus(move.captured) });
  }

  if (promoted) {
    const crownedPayload = {
      pieceId: movedPiece.id,
      owner: movedPiece.owner,
      square: move.to,
    } satisfies PieceCrownedPayload;
    events.push({
      type: 'piece.crowned',
      payload: crownedPayload,
      actor: ctx.actor,
      focus: pointFocus(move.to, { holdMs: CROWNED_HOLD_MS, priority: 'high' }),
    });
  }

  // Multi-jump chain: a capturing piece that is not freshly promoted and can
  // capture again from its new square MUST continue — the turn does not
  // pass. (Classic American-draughts ruling: promoting mid-chain ends the
  // turn immediately, even if the new king could technically jump again.)
  let activeChain: number | null = null;
  let turn = state.turn;
  if (move.kind === 'capture' && !promoted && B.captureMovesFrom(board, move.to).length > 0) {
    activeChain = move.to;
  } else {
    turn = state.seats[otherSeat(owner)];
  }

  const plysSinceCapture = move.kind === 'capture' ? 0 : state.plysSinceCapture + 1;

  const nextState: CheckersState = { ...state, board, turn, activeChain, plysSinceCapture };

  const result = computeResult(nextState);
  if (result) {
    const gameOverPayload = { result } satisfies GameOverPayload;
    events.push({
      type: 'game.over',
      payload: gameOverPayload,
      focus: { target: { kind: 'table' }, holdMs: GAME_OVER_HOLD_MS },
    });
  }

  return { state: nextState, events };
}

function view(state: CheckersState, _viewer: PlayerId): CheckersView {
  return {
    board: state.board.map((p) => (p ? { id: p.id, owner: p.owner, king: p.king } : null)),
    seats: state.seats,
    turn: state.turn,
    activeChain: state.activeChain,
    plysSinceCapture: state.plysSinceCapture,
    forcedCapture: state.forcedCapture,
    drawPlyLimit: state.drawPlyLimit,
  };
}

function currentActors(state: CheckersState): PlayerId[] {
  return computeResult(state) ? [] : [state.turn];
}

function isTerminal(state: CheckersState): GameResult | null {
  return computeResult(state);
}

function defaultAction(state: CheckersState, player: PlayerId): CheckersAction {
  const owner = seatIndexOfPlayer(state, player);

  if (state.activeChain !== null) {
    const chosen = B.captureMovesFrom(state.board, state.activeChain)[0];
    if (!chosen) throw new IllegalAction('checkers: no legal continuation available for default action');
    return { type: 'move', from: chosen.from, to: chosen.to };
  }

  const forced = state.forcedCapture && B.ownerHasAnyCapture(state.board, owner);
  for (let sq = 0; sq < B.BOARD_SQUARES; sq++) {
    const piece = state.board[sq];
    if (!piece || piece.owner !== owner) continue;
    const capture = B.captureMovesFrom(state.board, sq)[0];
    if (capture) return { type: 'move', from: capture.from, to: capture.to };
    if (!forced) {
      const simple = B.simpleMovesFrom(state.board, sq)[0];
      if (simple) return { type: 'move', from: simple.from, to: simple.to };
    }
  }

  throw new IllegalAction('checkers: no legal move available for default action');
}

export const checkersModule: GameModule<CheckersState, CheckersAction, CheckersView> = {
  meta: {
    id: 'checkers',
    title: 'Checkers',
    minPlayers: 2,
    maxPlayers: 2,
    estMinutes: 15,
    summary:
      'Classic diagonal-move capture game on an 8x8 board, with mandatory multi-jump chains and forced captures by default.',
  },
  setup,
  reduce,
  view,
  currentActors,
  isTerminal,
  defaultAction,
};
