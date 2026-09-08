// Small "plausible action" candidate generators for the three real v1
// games, shared by hidden-info-leak.test.ts and determinism.test.ts — both
// need to drive an actual playout of each real game (see ./playout.ts).
//
// These deliberately do NOT import anything from packages/games/* (see
// real-game-loader.ts's header for why this package can never take a
// static, type-level dependency on a game package) and so are untyped
// (`state`/`action` as `unknown`, narrowed with small local casts) — they
// only need to be *plausible*, not authoritative: playout.ts tries each
// candidate against the real reduce() and only keeps ones that don't throw
// IllegalAction, falling back to the game's own defaultAction() otherwise.
// Getting a candidate wrong here can only make a playout less interesting
// (more defaultAction() turns), never incorrect.
//
// Checkers' shape is read from packages/games/checkers/src/board.ts and
// module.ts (squares 0-63, row = floor(sq/8), col = sq%8, seat 0 moves
// toward row 0, seat 1 toward row 7); Hold'em and Codewords' shapes are
// read from their own module.ts/state.ts. None of that is imported here —
// just reimplemented at the tiny scale a "try some diagonal jumps" /
// "try check then call then fold" fixture needs.
import type { PlayerId } from '@party/protocol';
import type { Rng } from '../rng.js';

function shuffledCandidates(rng: Rng, candidates: unknown[]): unknown[] {
  return rng.shuffle(candidates);
}

// ---------------------------------------------------------------------------
// Checkers
// ---------------------------------------------------------------------------

const CHECKERS_BOARD_DIM = 8;

export function checkersCandidates(state: unknown, actorId: PlayerId, rng: Rng): unknown[] {
  const s = state as { board: Array<{ owner: 0 | 1; king: boolean } | null>; seats: [PlayerId, PlayerId] };
  const seat: 0 | 1 = s.seats[0] === actorId ? 0 : 1;

  const candidates: Array<{ type: 'move'; from: number; to: number }> = [];
  for (let square = 0; square < s.board.length; square++) {
    const piece = s.board[square];
    if (!piece || piece.owner !== seat) continue;
    const row = Math.floor(square / CHECKERS_BOARD_DIM);
    const col = square % CHECKERS_BOARD_DIM;
    const forward = seat === 0 ? -1 : 1;
    const dirs: Array<[number, number]> = piece.king
      ? [
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ]
      : [
          [forward, -1],
          [forward, 1],
        ];
    for (const [dr, dc] of dirs) {
      const simpleRow = row + dr;
      const simpleCol = col + dc;
      if (simpleRow >= 0 && simpleRow < CHECKERS_BOARD_DIM && simpleCol >= 0 && simpleCol < CHECKERS_BOARD_DIM) {
        candidates.push({ type: 'move', from: square, to: simpleRow * CHECKERS_BOARD_DIM + simpleCol });
      }
      const jumpRow = row + dr * 2;
      const jumpCol = col + dc * 2;
      if (jumpRow >= 0 && jumpRow < CHECKERS_BOARD_DIM && jumpCol >= 0 && jumpCol < CHECKERS_BOARD_DIM) {
        candidates.push({ type: 'move', from: square, to: jumpRow * CHECKERS_BOARD_DIM + jumpCol });
      }
    }
  }
  return shuffledCandidates(rng, candidates);
}

// ---------------------------------------------------------------------------
// Hold'em
// ---------------------------------------------------------------------------

export function holdemCandidates(state: unknown, actorId: PlayerId, rng: Rng): unknown[] {
  const s = state as {
    players: Array<{ id: PlayerId; committedRound: number }>;
    currentBet: number;
    minRaiseSize: number;
  };
  const player = s.players.find((p) => p.id === actorId);
  const candidates: unknown[] = [{ type: 'fold' }, { type: 'allin' }];
  if (player) {
    if (player.committedRound === s.currentBet) candidates.push({ type: 'check' });
    if (player.committedRound < s.currentBet) candidates.push({ type: 'call' });
  }
  if (s.currentBet === 0) {
    candidates.push({ type: 'bet', amount: s.minRaiseSize });
  } else {
    candidates.push({ type: 'raise', amount: s.currentBet + s.minRaiseSize });
  }
  return shuffledCandidates(rng, candidates);
}

// ---------------------------------------------------------------------------
// Codewords
// ---------------------------------------------------------------------------

export function codewordsCandidates(state: unknown, _actorId: PlayerId, rng: Rng): unknown[] {
  const s = state as {
    phase: 'clue' | 'guess' | 'ended';
    tiles: Array<{ id: string; word: string; revealed: boolean }>;
  };
  const candidates: unknown[] = [];

  if (s.phase === 'clue') {
    const boardWords = new Set(s.tiles.map((t) => t.word.toLowerCase()));
    let word = 'guardword';
    let suffix = 0;
    while (boardWords.has(word)) {
      word = `guardword${suffix++}`;
    }
    candidates.push({ type: 'clue.give', word, count: rng.int(4) });
  } else if (s.phase === 'guess') {
    for (const tile of s.tiles) {
      if (!tile.revealed) candidates.push({ type: 'tile.guess', tileId: tile.id });
    }
    candidates.push({ type: 'turn.pass' });
  }
  return shuffledCandidates(rng, candidates);
}
