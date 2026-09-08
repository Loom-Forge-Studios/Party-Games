// Pure board representation + move generation for Checkers. No randomness,
// no Three.js, no protocol/engine imports beyond nothing at all — this file
// is deliberately dependency-free so it can be reused unmodified by both
// module.ts (server-authoritative rules) and presenter.ts (client-side
// legal-move highlighting is UX only, per docs/ARCHITECTURE.md §7 — the
// server is still the sole authority on what actually happens).
//
// Board layout: 64 squares, index = row * 8 + col, row/col in [0, 7]. Only
// "dark" squares (row + col is odd) are ever occupied or playable, matching
// standard checkers/draughts. Seat 0's pieces start on rows 5-7 and move
// toward row 0; seat 1's pieces start on rows 0-2 and move toward row 7 —
// see layout.ts's header comment for why this matches the table's seat
// geometry (seat 0 sits at +Z, seat 1 at -Z).

export type Seat = 0 | 1;

export interface Piece {
  readonly id: string;
  readonly owner: Seat;
  readonly king: boolean;
}

export type Board = ReadonlyArray<Piece | null>;

export const BOARD_DIM = 8;
export const BOARD_SQUARES = BOARD_DIM * BOARD_DIM;

export function squareToRowCol(square: number): { row: number; col: number } {
  return { row: Math.floor(square / BOARD_DIM), col: square % BOARD_DIM };
}

export function rowColToSquare(row: number, col: number): number {
  return row * BOARD_DIM + col;
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_DIM && col >= 0 && col < BOARD_DIM;
}

/** Whether `square` is a valid, in-bounds, dark (playable) square. */
export function isPlayableSquare(square: number): boolean {
  if (!Number.isInteger(square) || square < 0 || square >= BOARD_SQUARES) return false;
  const { row, col } = squareToRowCol(square);
  return (row + col) % 2 === 1;
}

/** Seat 0 moves toward row 0; seat 1 moves toward row 7. See file header. */
function forwardDir(owner: Seat): -1 | 1 {
  return owner === 0 ? -1 : 1;
}

/** The row a piece must reach to be crowned a king. */
export function isBackRow(owner: Seat, row: number): boolean {
  return owner === 0 ? row === 0 : row === BOARD_DIM - 1;
}

export interface SimpleMove {
  kind: 'simple';
  from: number;
  to: number;
}

export interface CaptureMove {
  kind: 'capture';
  from: number;
  to: number;
  /** Square of the opponent piece jumped over and removed. */
  captured: number;
}

export type Move = SimpleMove | CaptureMove;

const ALL_DIAGONALS: ReadonlyArray<{ dr: -1 | 1; dc: -1 | 1 }> = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: 1, dc: 1 },
];

/** Directions a piece may move in: all four diagonals for a king, only the owner's forward diagonals for a man. */
function directionsFor(piece: Piece): ReadonlyArray<{ dr: -1 | 1; dc: -1 | 1 }> {
  if (piece.king) return ALL_DIAGONALS;
  const fwd = forwardDir(piece.owner);
  return ALL_DIAGONALS.filter((d) => d.dr === fwd);
}

/** Non-capturing one-step diagonal moves available to the piece at `square`. */
export function simpleMovesFrom(board: Board, square: number): SimpleMove[] {
  const piece = board[square];
  if (!piece) return [];
  const { row, col } = squareToRowCol(square);
  const moves: SimpleMove[] = [];
  for (const { dr, dc } of directionsFor(piece)) {
    const r = row + dr;
    const c = col + dc;
    if (!inBounds(r, c)) continue;
    const to = rowColToSquare(r, c);
    if (board[to] === null) moves.push({ kind: 'simple', from: square, to });
  }
  return moves;
}

/** Capturing two-step jumps available to the piece at `square` (landing square must be empty, jumped square must hold an opponent piece). */
export function captureMovesFrom(board: Board, square: number): CaptureMove[] {
  const piece = board[square];
  if (!piece) return [];
  const { row, col } = squareToRowCol(square);
  const moves: CaptureMove[] = [];
  for (const { dr, dc } of directionsFor(piece)) {
    const midRow = row + dr;
    const midCol = col + dc;
    const landRow = row + dr * 2;
    const landCol = col + dc * 2;
    if (!inBounds(landRow, landCol)) continue;
    const midSquare = rowColToSquare(midRow, midCol);
    const landSquare = rowColToSquare(landRow, landCol);
    const midPiece = board[midSquare];
    if (midPiece && midPiece.owner !== piece.owner && board[landSquare] === null) {
      moves.push({ kind: 'capture', from: square, to: landSquare, captured: midSquare });
    }
  }
  return moves;
}

/** All legal moves for the piece at `square` — captures first, then simple moves. Does not apply the forced-capture rule (that's a whole-board, whole-turn concern; see module.ts). */
export function legalMovesFrom(board: Board, square: number): Move[] {
  return [...captureMovesFrom(board, square), ...simpleMovesFrom(board, square)];
}

/** True if any of `owner`'s pieces has at least one capture available anywhere on the board — the trigger for the forced-capture rule. */
export function ownerHasAnyCapture(board: Board, owner: Seat): boolean {
  for (let sq = 0; sq < BOARD_SQUARES; sq++) {
    const piece = board[sq];
    if (piece && piece.owner === owner && captureMovesFrom(board, sq).length > 0) return true;
  }
  return false;
}

/** True if any of `owner`'s pieces has at least one legal move (capture or simple) anywhere on the board. */
export function ownerHasAnyMove(board: Board, owner: Seat): boolean {
  for (let sq = 0; sq < BOARD_SQUARES; sq++) {
    const piece = board[sq];
    if (piece && piece.owner === owner && legalMovesFrom(board, sq).length > 0) return true;
  }
  return false;
}

export function ownerPieceCount(board: Board, owner: Seat): number {
  let count = 0;
  for (const piece of board) {
    if (piece && piece.owner === owner) count++;
  }
  return count;
}

/** The standard starting position: 12 men per side on the dark squares of their three nearest rows. Piece ids are stable for the whole game (`c0`..`c23`) so the presenter can track one mesh per id across moves/captures. */
export function initialBoard(): Array<Piece | null> {
  const board: Array<Piece | null> = new Array(BOARD_SQUARES).fill(null);
  let nextId = 0;

  for (let row = 5; row < BOARD_DIM; row++) {
    for (let col = 0; col < BOARD_DIM; col++) {
      if ((row + col) % 2 === 1) {
        board[rowColToSquare(row, col)] = { id: `c${nextId++}`, owner: 0, king: false };
      }
    }
  }
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < BOARD_DIM; col++) {
      if ((row + col) % 2 === 1) {
        board[rowColToSquare(row, col)] = { id: `c${nextId++}`, owner: 1, king: false };
      }
    }
  }
  return board;
}
