// Owned by A11. Drives a full Checkers game to game.over without any UI
// move-clicking, per the assignment brief: "with SERVER_SEED fixed and
// Checkers' own defaultAction() being deterministic ... you can drive both
// players' moves programmatically". `defaultAction` is the exact same pure
// function packages/server/src/host/game-host.ts calls on turn-timeout for
// a disconnected player — reusing it here (rather than reimplementing
// "pick a legal move" ourselves) guarantees every move we submit is
// legal-by-construction and that the whole game is 100% reproducible move
// for move, run for run (verified during development: a pure self-play
// simulation with no server involved always finishes in exactly the same
// 45 plies with the same winner, since packages/games/checkers has zero
// randomness — see module.ts's header comment).
import type { Page } from '@playwright/test';
import { checkersModule, type CheckersAction, type CheckersState, type CheckersView } from '@party/game-checkers';
import type { PlayerId, RoomState, ServerMessage } from '@party/protocol';
import { getLatestMessage, sendClientMessage } from './ws-capture.js';

type GameOverMessage = Extract<ServerMessage, { t: 'game.over' }>;

/** A CheckersView (game.view's payload) is structurally identical to CheckersState — same board/seats/turn/activeChain/plysSinceCapture/forcedCapture/drawPlyLimit fields (see packages/games/checkers/src/module.ts) — so defaultAction(), which only reads those fields, works unmodified on either. */
function viewAsState(view: CheckersView): CheckersState {
  return view as unknown as CheckersState;
}

export interface CheckersSeatPages {
  /** Maps a room seat number to the Page whose own real Connection is authenticated as that seat's player. */
  bySeat: Map<number, Page>;
  bySeatPlayerId: Map<number, PlayerId>;
}

export function mapSeatsToPages(room: RoomState, pageByPlayerId: Map<PlayerId, Page>): CheckersSeatPages {
  const bySeat = new Map<number, Page>();
  const bySeatPlayerId = new Map<number, PlayerId>();
  for (const player of room.players) {
    const page = pageByPlayerId.get(player.id);
    if (!page) throw new Error(`mapSeatsToPages: no Page registered for player ${player.id}`);
    bySeat.set(player.seat, page);
    bySeatPlayerId.set(player.seat, player.id);
  }
  return { bySeat, bySeatPlayerId };
}

/**
 * Plays out a full Checkers game by always submitting defaultAction() for
 * whichever seat's turn it currently is (reading the latest game.view from
 * `viewSourcePage`, which sees every player's game.view identically since
 * Checkers has no hidden information). Resolves once `game.over` is
 * observed; throws if it isn't reached within `maxPlies` (a real bug, not a
 * slow-but-fine game — a full self-play run reaches game.over in 45 plies,
 * see this file's header comment, so the default cap leaves generous room
 * without masking a genuine stuck-game defect as a timeout).
 */
export async function playCheckersToGameOver(
  viewSourcePage: Page,
  seats: CheckersSeatPages,
  opts: { maxPlies?: number } = {},
): Promise<GameOverMessage> {
  const maxPlies = opts.maxPlies ?? 200;

  for (let ply = 0; ply < maxPlies; ply++) {
    const gameOver = await getLatestMessage(viewSourcePage, 'game.over');
    if (gameOver) return gameOver;

    const latest = await getLatestMessage(viewSourcePage, 'game.view');
    if (!latest) throw new Error('playCheckersToGameOver: no game.view observed yet');
    const view = latest.view as CheckersView;
    const sinceVersion = latest.version;

    const actorId = view.turn;
    const actorSeat = view.seats[0] === actorId ? 0 : 1;
    const actorPage = seats.bySeat.get(actorSeat);
    if (!actorPage) throw new Error(`playCheckersToGameOver: no page registered for seat ${actorSeat}`);

    const action: CheckersAction = checkersModule.defaultAction(viewAsState(view), actorId);
    await sendClientMessage(actorPage, { t: 'game.action', action });

    await waitForVersionAdvanceOrGameOver(viewSourcePage, sinceVersion);
  }

  throw new Error(`playCheckersToGameOver: game.over not reached within ${maxPlies} plies — likely a real bug`);
}

async function waitForVersionAdvanceOrGameOver(page: Page, sinceVersion: number): Promise<void> {
  await page.waitForFunction(
    (v) => {
      const msgs = window.__pgMessages ?? [];
      return msgs.some((m) => m.t === 'game.over') || msgs.some((m) => m.t === 'game.view' && m.version > v);
    },
    sinceVersion,
    { timeout: 15_000 },
  );
}
