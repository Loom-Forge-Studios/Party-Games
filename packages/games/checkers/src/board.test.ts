import { describe, expect, it } from 'vitest';
import * as B from './board.js';

function emptyBoard(): Array<B.Piece | null> {
  return new Array(B.BOARD_SQUARES).fill(null);
}

function place(board: Array<B.Piece | null>, square: number, piece: B.Piece): void {
  board[square] = piece;
}

describe('board.ts — pure move generation', () => {
  it('initialBoard() places 12 men per side on dark squares only, none in the middle two rows', () => {
    const board = B.initialBoard();
    expect(B.ownerPieceCount(board, 0)).toBe(12);
    expect(B.ownerPieceCount(board, 1)).toBe(12);
    for (let sq = 0; sq < B.BOARD_SQUARES; sq++) {
      const piece = board[sq];
      if (!piece) continue;
      expect(B.isPlayableSquare(sq)).toBe(true);
      expect(piece.king).toBe(false);
      const { row } = B.squareToRowCol(sq);
      expect(row === 3 || row === 4).toBe(false);
    }
    // Every id is unique.
    const ids = new Set(board.filter((p): p is B.Piece => p !== null).map((p) => p.id));
    expect(ids.size).toBe(24);
  });

  it('a man only moves diagonally forward (toward its own king row), never backward, when not capturing', () => {
    const board = emptyBoard();
    // Seat 0 moves toward row 0. Put a seat-0 man in the middle of the board.
    place(board, B.rowColToSquare(4, 3), { id: 'a', owner: 0, king: false });
    const moves = B.simpleMovesFrom(board, B.rowColToSquare(4, 3));
    const targets = moves.map((m) => B.squareToRowCol(m.to).row).sort();
    expect(targets).toEqual([3, 3]); // both forward-diagonal targets are row 3, never row 5
  });

  it('a king moves diagonally in all four directions', () => {
    const board = emptyBoard();
    place(board, B.rowColToSquare(4, 3), { id: 'k', owner: 0, king: true });
    const moves = B.simpleMovesFrom(board, B.rowColToSquare(4, 3));
    expect(moves).toHaveLength(4);
  });

  it('captureMovesFrom finds a jump over an adjacent opponent onto an empty landing square', () => {
    const board = emptyBoard();
    place(board, B.rowColToSquare(4, 3), { id: 'a', owner: 0, king: false });
    place(board, B.rowColToSquare(3, 2), { id: 'b', owner: 1, king: false });
    const moves = B.captureMovesFrom(board, B.rowColToSquare(4, 3));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      from: B.rowColToSquare(4, 3),
      to: B.rowColToSquare(2, 1),
      captured: B.rowColToSquare(3, 2),
    });
  });

  it('does not allow jumping your own piece, or landing on an occupied square', () => {
    const board = emptyBoard();
    place(board, B.rowColToSquare(4, 3), { id: 'a', owner: 0, king: false });
    place(board, B.rowColToSquare(3, 2), { id: 'friend', owner: 0, king: false });
    expect(B.captureMovesFrom(board, B.rowColToSquare(4, 3))).toHaveLength(0);

    place(board, B.rowColToSquare(3, 2), { id: 'foe', owner: 1, king: false });
    place(board, B.rowColToSquare(2, 1), { id: 'blocker', owner: 1, king: false });
    expect(B.captureMovesFrom(board, B.rowColToSquare(4, 3))).toHaveLength(0);
  });

  it('ownerHasAnyCapture is true only when some piece of that owner has a capture available', () => {
    const board = emptyBoard();
    expect(B.ownerHasAnyCapture(board, 0)).toBe(false);
    place(board, B.rowColToSquare(4, 3), { id: 'a', owner: 0, king: false });
    place(board, B.rowColToSquare(3, 2), { id: 'b', owner: 1, king: false });
    // 'a' can jump 'b' landing on (2,1), which is empty — owner 0 has a capture.
    expect(B.ownerHasAnyCapture(board, 0)).toBe(true);
    // 'b' jumping 'a' would land on (5,4) — occupy it so owner 1 does NOT have a capture.
    place(board, B.rowColToSquare(5, 4), { id: 'blocker', owner: 0, king: false });
    expect(B.ownerHasAnyCapture(board, 1)).toBe(false);
  });

  it('isBackRow: seat 0 is crowned on row 0, seat 1 is crowned on row 7', () => {
    expect(B.isBackRow(0, 0)).toBe(true);
    expect(B.isBackRow(0, 7)).toBe(false);
    expect(B.isBackRow(1, 7)).toBe(true);
    expect(B.isBackRow(1, 0)).toBe(false);
  });

  it('isPlayableSquare rejects light squares and out-of-range indices', () => {
    expect(B.isPlayableSquare(B.rowColToSquare(0, 0))).toBe(false); // (0,0) is light
    expect(B.isPlayableSquare(B.rowColToSquare(0, 1))).toBe(true);
    expect(B.isPlayableSquare(-1)).toBe(false);
    expect(B.isPlayableSquare(64)).toBe(false);
  });
});
