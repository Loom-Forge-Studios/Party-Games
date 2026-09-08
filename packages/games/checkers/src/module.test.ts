import { describe, expect, it } from 'vitest';
import { createRng, IllegalAction, type ReduceCtx } from '@party/engine';
import type { PlayerPublic } from '@party/protocol';
import * as B from './board.js';
import {
  checkersModule,
  DEFAULT_DRAW_PLY_LIMIT,
  DEFAULT_FORCED_CAPTURE,
  type CheckersState,
} from './module.js';

const P0 = 'alice';
const P1 = 'bob';

function players(): PlayerPublic[] {
  return [
    { id: P0, username: P0, seat: 0, connected: true, isHost: true },
    { id: P1, username: P1, seat: 1, connected: true, isHost: false },
  ];
}

function freshState(overrides: Partial<CheckersState> = {}): CheckersState {
  return checkersModule.setup({ players: players(), rng: createRng(1), ...overrides });
}

/** Builds a synthetic mid-game state directly (bypassing setup()'s standard opening layout) so individual rules — forced capture, multi-jump, promotion, terminal conditions — can each be tested against a hand-picked, minimal board. */
function customState(board: Array<B.Piece | null>, overrides: Partial<CheckersState> = {}): CheckersState {
  return {
    board,
    seats: [P0, P1],
    turn: P0,
    activeChain: null,
    plysSinceCapture: 0,
    forcedCapture: DEFAULT_FORCED_CAPTURE,
    drawPlyLimit: DEFAULT_DRAW_PLY_LIMIT,
    ...overrides,
  };
}

function emptyBoard(): Array<B.Piece | null> {
  return new Array(B.BOARD_SQUARES).fill(null);
}

function reduceCtx(actor: string): ReduceCtx {
  return { actor, rng: createRng(7) };
}

describe('checkersModule.setup', () => {
  it('seats players by their seat number and deals the standard 24-piece opening position', () => {
    const state = freshState();
    expect(state.seats).toEqual([P0, P1]);
    expect(state.turn).toBe(P0); // seat 0 moves first
    expect(state.activeChain).toBeNull();
    expect(state.forcedCapture).toBe(true);
    expect(state.drawPlyLimit).toBe(40);
    expect(B.ownerPieceCount(state.board, 0)).toBe(12);
    expect(B.ownerPieceCount(state.board, 1)).toBe(12);
  });

  it('honors CheckersOptions overrides', () => {
    const state = checkersModule.setup({ players: players(), rng: createRng(1), options: { forcedCapture: false, drawPlyLimit: 5 } });
    expect(state.forcedCapture).toBe(false);
    expect(state.drawPlyLimit).toBe(5);
  });
});

describe('checkersModule.reduce — basic legality', () => {
  it('applies a simple move and passes the turn', () => {
    const state = freshState();
    const from = B.rowColToSquare(5, 2);
    const to = B.rowColToSquare(4, 1);
    const { state: next, events } = checkersModule.reduce(state, { type: 'move', from, to }, reduceCtx(P0));
    expect(next.board[from]).toBeNull();
    expect(next.board[to]).toMatchObject({ owner: 0, king: false });
    expect(next.turn).toBe(P1);
    expect(next.plysSinceCapture).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'piece.moved', focus: { target: { kind: 'point' } } });
  });

  it('rejects a move from a player who is not the current actor', () => {
    const state = freshState();
    expect(() =>
      checkersModule.reduce(state, { type: 'move', from: B.rowColToSquare(2, 1), to: B.rowColToSquare(3, 0) }, reduceCtx(P1)),
    ).toThrow(IllegalAction);
  });

  it('rejects moving an empty square, an opponent piece, or a non-diagonal target', () => {
    const state = freshState();
    expect(() => checkersModule.reduce(state, { type: 'move', from: B.rowColToSquare(3, 0), to: B.rowColToSquare(2, 1) }, reduceCtx(P0))).toThrow(
      IllegalAction,
    );
    expect(() => checkersModule.reduce(state, { type: 'move', from: B.rowColToSquare(2, 1), to: B.rowColToSquare(3, 0) }, reduceCtx(P0))).toThrow(
      IllegalAction,
    );
    expect(() => checkersModule.reduce(state, { type: 'move', from: B.rowColToSquare(5, 2), to: B.rowColToSquare(4, 2) }, reduceCtx(P0))).toThrow(
      IllegalAction,
    );
  });

  it('rejects a malformed action', () => {
    const state = freshState();
    expect(() => checkersModule.reduce(state, { type: 'nope' } as never, reduceCtx(P0))).toThrow(IllegalAction);
  });
});

describe('checkersModule.reduce — forced capture', () => {
  function forcedCaptureSetup(forcedCapture: boolean): CheckersState {
    const board = emptyBoard();
    // 'mover' can capture 'foe'; 'idle' has an ordinary non-capturing move available too.
    board[B.rowColToSquare(4, 1)] = { id: 'mover', owner: 0, king: false };
    board[B.rowColToSquare(3, 2)] = { id: 'foe', owner: 1, king: false };
    board[B.rowColToSquare(5, 4)] = { id: 'idle', owner: 0, king: false };
    return customState(board, { forcedCapture });
  }

  it('rejects a non-capturing move when a capture is available and forcedCapture is on (default)', () => {
    const state = forcedCaptureSetup(true);
    expect(() =>
      checkersModule.reduce(state, { type: 'move', from: B.rowColToSquare(5, 4), to: B.rowColToSquare(4, 3) }, reduceCtx(P0)),
    ).toThrow(/capture is available/);
  });

  it('accepts the capturing move when forced capture is on', () => {
    const state = forcedCaptureSetup(true);
    const { state: next } = checkersModule.reduce(
      state,
      { type: 'move', from: B.rowColToSquare(4, 1), to: B.rowColToSquare(2, 3) },
      reduceCtx(P0),
    );
    expect(next.board[B.rowColToSquare(3, 2)]).toBeNull(); // 'foe' removed
    expect(next.board[B.rowColToSquare(2, 3)]).toMatchObject({ id: 'mover' });
    expect(next.turn).toBe(P1); // no further capture from the landing square — turn passes
    expect(next.plysSinceCapture).toBe(0);
  });

  it('allows a non-capturing move when forcedCapture is off, even with a capture available', () => {
    const state = forcedCaptureSetup(false);
    const { state: next } = checkersModule.reduce(
      state,
      { type: 'move', from: B.rowColToSquare(5, 4), to: B.rowColToSquare(4, 3) },
      reduceCtx(P0),
    );
    expect(next.board[B.rowColToSquare(4, 3)]).toMatchObject({ id: 'idle' });
    expect(next.board[B.rowColToSquare(3, 2)]).toMatchObject({ id: 'foe' }); // untouched
  });
});

describe('checkersModule.reduce — multi-jump chains', () => {
  function chainSetup(): CheckersState {
    const board = emptyBoard();
    board[B.rowColToSquare(6, 3)] = { id: 'chainer', owner: 0, king: false };
    board[B.rowColToSquare(5, 4)] = { id: 'foe1', owner: 1, king: false };
    board[B.rowColToSquare(3, 6)] = { id: 'foe2', owner: 1, king: false };
    // An unrelated seat-0 piece with its own legal move, so "must continue
    // with the SAME piece" has something else to reject a move to.
    board[B.rowColToSquare(7, 6)] = { id: 'idle', owner: 0, king: false };
    return customState(board);
  }

  it('keeps the turn with the same actor and the same piece after a capture that can capture again', () => {
    const state = chainSetup();
    const { state: mid, events } = checkersModule.reduce(
      state,
      { type: 'move', from: B.rowColToSquare(6, 3), to: B.rowColToSquare(4, 5) },
      reduceCtx(P0),
    );
    expect(mid.activeChain).toBe(B.rowColToSquare(4, 5));
    expect(mid.turn).toBe(P0); // NOT passed to p1 yet
    expect(checkersModule.currentActors(mid)).toEqual([P0]);
    expect(events.some((e) => e.type === 'piece.captured')).toBe(true);
    expect(events.some((e) => e.type === 'game.over')).toBe(false);
  });

  it('rejects moving a different piece while a chain is active', () => {
    const state = chainSetup();
    const { state: mid } = checkersModule.reduce(state, { type: 'move', from: B.rowColToSquare(6, 3), to: B.rowColToSquare(4, 5) }, reduceCtx(P0));
    expect(() =>
      checkersModule.reduce(mid, { type: 'move', from: B.rowColToSquare(7, 6), to: B.rowColToSquare(6, 5) }, reduceCtx(P0)),
    ).toThrow(/must continue capturing/);
  });

  it('rejects trying to stop a chain with a non-capturing move, even with forcedCapture off', () => {
    const state = { ...chainSetup(), forcedCapture: false };
    const { state: mid } = checkersModule.reduce(state, { type: 'move', from: B.rowColToSquare(6, 3), to: B.rowColToSquare(4, 5) }, reduceCtx(P0));
    // (3,4) would be a perfectly legal *simple* move from (4,5) if there
    // were no chain in progress — that's the point of the test.
    // Chain continuation is a base rule, not gated by the forcedCapture option.
    expect(() =>
      checkersModule.reduce(mid, { type: 'move', from: B.rowColToSquare(4, 5), to: B.rowColToSquare(3, 4) }, reduceCtx(P0)),
    ).toThrow(/must continue capturing/);
  });

  it('completes the chain, capturing both pieces and finally passing the turn', () => {
    const state = chainSetup();
    const { state: mid } = checkersModule.reduce(state, { type: 'move', from: B.rowColToSquare(6, 3), to: B.rowColToSquare(4, 5) }, reduceCtx(P0));
    const { state: final, events } = checkersModule.reduce(
      mid,
      { type: 'move', from: B.rowColToSquare(4, 5), to: B.rowColToSquare(2, 7) },
      reduceCtx(P0),
    );
    expect(final.activeChain).toBeNull();
    expect(final.turn).toBe(P1);
    expect(final.board[B.rowColToSquare(5, 4)]).toBeNull(); // foe1
    expect(final.board[B.rowColToSquare(3, 6)]).toBeNull(); // foe2
    expect(final.board[B.rowColToSquare(2, 7)]).toMatchObject({ id: 'chainer' });
    expect(events.filter((e) => e.type === 'piece.captured')).toHaveLength(1);
  });
});

describe('checkersModule.reduce — promotion', () => {
  it('crowns a man that reaches its back row and emits piece.crowned with a longer hold', () => {
    const board = emptyBoard();
    board[B.rowColToSquare(1, 2)] = { id: 'climber', owner: 0, king: false };
    const state = customState(board);
    const { state: next, events } = checkersModule.reduce(
      state,
      { type: 'move', from: B.rowColToSquare(1, 2), to: B.rowColToSquare(0, 1) },
      reduceCtx(P0),
    );
    expect(next.board[B.rowColToSquare(0, 1)]).toMatchObject({ king: true });
    const crowned = events.find((e) => e.type === 'piece.crowned');
    expect(crowned).toBeDefined();
    expect(crowned!.focus?.holdMs).toBeGreaterThan(1200);
    expect(crowned!.focus?.priority).toBe('high');
    const moved = events.find((e) => e.type === 'piece.moved');
    expect(events.indexOf(moved!)).toBeLessThan(events.indexOf(crowned!));
  });

  it('ends the multi-jump chain immediately on promotion, even if the new king could capture again', () => {
    const board = emptyBoard();
    board[B.rowColToSquare(2, 1)] = { id: 'jumper', owner: 0, king: false };
    board[B.rowColToSquare(1, 2)] = { id: 'foe', owner: 1, king: false }; // captured to land on the back row
    board[B.rowColToSquare(1, 4)] = { id: 'temptation', owner: 1, king: false }; // would offer a further king-capture from (0,3), but must NOT be taken
    const state = customState(board);
    const { state: next, events } = checkersModule.reduce(
      state,
      { type: 'move', from: B.rowColToSquare(2, 1), to: B.rowColToSquare(0, 3) },
      reduceCtx(P0),
    );
    expect(next.board[B.rowColToSquare(0, 3)]).toMatchObject({ id: 'jumper', king: true });
    expect(next.activeChain).toBeNull();
    expect(next.turn).toBe(P1);
    expect(next.board[B.rowColToSquare(1, 4)]).toMatchObject({ id: 'temptation' }); // untouched
    expect(events.filter((e) => e.type === 'piece.captured')).toHaveLength(1);
  });
});

describe('checkersModule.isTerminal / currentActors', () => {
  it('is not terminal for the standard opening position', () => {
    expect(checkersModule.isTerminal(freshState())).toBeNull();
  });

  it('the mover loses when they have no pieces remaining', () => {
    const board = emptyBoard();
    board[B.rowColToSquare(0, 1)] = { id: 'survivor', owner: 1, king: false };
    const state = customState(board, { turn: P0 });
    const result = checkersModule.isTerminal(state);
    expect(result).toMatchObject({ winners: [P1] });
    expect(result!.reason).toMatch(/no pieces/);
    expect(checkersModule.currentActors(state)).toEqual([]);
  });

  it('the mover loses when every one of their pieces is fully blocked', () => {
    const board = emptyBoard();
    board[B.rowColToSquare(7, 0)] = { id: 'lonely', owner: 0, king: false };
    board[B.rowColToSquare(6, 1)] = { id: 'blocker1', owner: 1, king: false };
    board[B.rowColToSquare(5, 2)] = { id: 'blocker2', owner: 1, king: false }; // occupies the only possible landing square
    const state = customState(board, { turn: P0 });
    const result = checkersModule.isTerminal(state);
    expect(result).toMatchObject({ winners: [P1] });
    expect(result!.reason).toMatch(/no legal moves/);
    expect(checkersModule.currentActors(state)).toEqual([]);
  });

  it('is a draw once the no-capture ply limit is reached', () => {
    const board = emptyBoard();
    board[B.rowColToSquare(4, 1)] = { id: 'a', owner: 0, king: false };
    board[B.rowColToSquare(0, 1)] = { id: 'b', owner: 1, king: false };
    const state = customState(board, { drawPlyLimit: 3, plysSinceCapture: 3 });
    const result = checkersModule.isTerminal(state);
    expect(result).toMatchObject({ winners: [] });
    expect(result!.reason).toMatch(/draw/);
  });

  it('reduce() itself emits a game.over event once a move pushes plysSinceCapture over the limit', () => {
    const board = emptyBoard();
    board[B.rowColToSquare(4, 1)] = { id: 'a', owner: 0, king: false };
    board[B.rowColToSquare(0, 1)] = { id: 'b', owner: 1, king: false };
    const state = customState(board, { drawPlyLimit: 1, plysSinceCapture: 0 });
    const { state: next, events } = checkersModule.reduce(state, { type: 'move', from: B.rowColToSquare(4, 1), to: B.rowColToSquare(3, 0) }, reduceCtx(P0));
    expect(next.plysSinceCapture).toBe(1);
    const over = events.find((e) => e.type === 'game.over');
    expect(over).toBeDefined();
    expect(over!.focus).toMatchObject({ target: { kind: 'table' } });
    expect((over!.payload as { result: { winners: string[] } }).result.winners).toEqual([]);
  });

  it('reduce() throws once the game is already over', () => {
    const board = emptyBoard();
    board[B.rowColToSquare(0, 1)] = { id: 'survivor', owner: 1, king: false };
    const state = customState(board, { turn: P0 });
    expect(() => checkersModule.reduce(state, { type: 'move', from: 0, to: 1 }, reduceCtx(P0))).toThrow(IllegalAction);
  });
});

describe('checkersModule.defaultAction', () => {
  it('continues an active chain with the same piece', () => {
    const board = emptyBoard();
    // Models the state right after the chain piece's first hop landed on
    // (4,5) — see the "multi-jump chains" describe block above for the
    // full two-hop sequence this is a snapshot of.
    board[B.rowColToSquare(4, 5)] = { id: 'chainer', owner: 0, king: false };
    board[B.rowColToSquare(3, 6)] = { id: 'foe2', owner: 1, king: false };
    const state = customState(board, { activeChain: B.rowColToSquare(4, 5), turn: P0 });
    const action = checkersModule.defaultAction(state, P0);
    expect(action).toEqual({ type: 'move', from: B.rowColToSquare(4, 5), to: B.rowColToSquare(2, 7) });
  });

  it('picks a capturing move when forced capture is active', () => {
    const board = emptyBoard();
    board[B.rowColToSquare(4, 1)] = { id: 'mover', owner: 0, king: false };
    board[B.rowColToSquare(3, 2)] = { id: 'foe', owner: 1, king: false };
    const state = customState(board);
    const action = checkersModule.defaultAction(state, P0);
    expect(action).toEqual({ type: 'move', from: B.rowColToSquare(4, 1), to: B.rowColToSquare(2, 3) });
  });

  it('picks a deterministic legal move when nothing is forced', () => {
    const state = freshState();
    const action = checkersModule.defaultAction(state, P0);
    expect(action.type).toBe('move');
    expect(() => checkersModule.reduce(state, action, reduceCtx(P0))).not.toThrow();
  });
});

describe('checkersModule.view', () => {
  it('gives both players the same full board — checkers has no hidden information', () => {
    const state = freshState();
    const viewA = checkersModule.view(state, P0);
    const viewB = checkersModule.view(state, P1);
    expect(viewA).toEqual(viewB);
    expect(viewA.board.filter(Boolean)).toHaveLength(24);
  });
});

describe('checkersModule — full-game determinism', () => {
  /**
   * Plays a complete game (setup -> reduce until isTerminal()) using the
   * module's own deterministic defaultAction() as the "AI" for both sides —
   * this sidesteps having to hand-verify a long sequence of real board
   * coordinates while still exercising setup/reduce/currentActors/
   * isTerminal/defaultAction together over a real game. defaultAction never
   * calls Math.random() (see module.ts), so replaying the same seed must
   * produce byte-identical history.
   */
  function playFullGame(seed: number) {
    const rng = createRng(seed);
    let state = checkersModule.setup({ players: players(), rng });
    const history: unknown[] = [];
    let result = checkersModule.isTerminal(state);
    let guard = 0;
    while (!result && guard < 2000) {
      guard++;
      const actor = state.turn;
      const action = checkersModule.defaultAction(state, actor);
      const step = checkersModule.reduce(state, action, { actor, rng });
      state = step.state;
      history.push({ actor, action, events: step.events });
      result = checkersModule.isTerminal(state);
    }
    if (!result) throw new Error('game did not terminate within the guard limit');
    return { finalState: state, result, history, plyCount: guard };
  }

  it('produces byte-identical state, result, and event history for two runs of the same seed', () => {
    const runA = playFullGame(20260908);
    const runB = playFullGame(20260908);

    expect(runA.plyCount).toBeGreaterThan(0);
    expect(runA.plyCount).toBe(runB.plyCount);
    expect(JSON.stringify(runA.finalState)).toBe(JSON.stringify(runB.finalState));
    expect(JSON.stringify(runA.result)).toBe(JSON.stringify(runB.result));
    expect(JSON.stringify(runA.history)).toBe(JSON.stringify(runB.history));
  });

  it('a different seed is free to (but need not) diverge, and still terminates cleanly', () => {
    const runA = playFullGame(1);
    const runB = playFullGame(2);
    // Checkers itself uses no randomness, so nothing here actually forces
    // divergence between seeds — the real assertion is just that both are
    // still internally deterministic and both reach a real conclusion.
    expect(runA.result.reason).toBeTruthy();
    expect(runB.result.reason).toBeTruthy();
  });
});
