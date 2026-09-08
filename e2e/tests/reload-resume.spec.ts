import { test, expect } from '@playwright/test';
import type { ServerMessage } from '@party/protocol';
import { getLatestMessage, installWsCaptureOn, sendClientMessage, waitForMessage } from '../support/ws-capture.js';

type GameViewMessage = Extract<ServerMessage, { t: 'game.view' }>;
type HelloOkMessage = Extract<ServerMessage, { t: 'hello.ok' }>;
import {
  createRoom,
  enterUsername,
  getOwnPlayerId,
  joinRoom,
  startRoom,
  waitForPlayerCount,
  waitForTableScreen,
} from '../support/lobby-flow.js';

// Scenario 3 from the A11 brief. Uses Hold'em (not Checkers) specifically
// because Checkers has no hidden information to verify resume of — Hold'em's
// `view.you.holeCards` (see packages/games/holdem/src/state.ts's HoldemView)
// is exactly the kind of per-viewer secret this scenario needs: present only
// for the viewer's own connection, server-authoritative, and — critically —
// unchanged for the rest of a hand no matter what either player does, so
// "same hidden hand before and after reload" is a real, load-bearing
// assertion rather than a coincidence of timing.
//
// UPDATE (overseer): A11 originally found a real gap here — a resumed
// `hello` got `hello.ok` + `room.state` and nothing else, so a reloaded
// client rendered nothing until the next action from *either* player
// happened to trigger a fan-out. Fixed via GameHost.resendViewTo() /
// HostManager.resendViewOnReconnect(), called from net's onHello when
// `resumed` is true (see packages/server/src/index.ts) — a reconnecting
// player now gets an immediate game.view. This test still nudges the hand
// forward by one action afterward anyway: it's a stronger assertion this
// way (proves a SUBSEQUENT fan-out also still has the right hidden hand,
// not just the immediate reconnect one), not a workaround for a gap.
test('a player who reloads mid-hand resumes the same seat and the same hidden hand', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  try {
    await installWsCaptureOn(hostPage);
    await installWsCaptureOn(guestPage);

    await hostPage.goto('/');
    await guestPage.goto('/');

    await enterUsername(hostPage, 'Host');
    await enterUsername(guestPage, 'Guest');

    const roomId = await createRoom(hostPage, { gameId: 'holdem', maxPlayers: 2 });
    await joinRoom(guestPage, roomId);

    await waitForPlayerCount(hostPage, 2);
    const roomBeforeStart = await waitForPlayerCount(guestPage, 2);

    await startRoom(hostPage);
    await waitForTableScreen(hostPage);
    await waitForTableScreen(guestPage);

    const guestId = await getOwnPlayerId(guestPage);
    const hostId = await getOwnPlayerId(hostPage);
    const guestSeatBefore = roomBeforeStart.players.find((p) => p.id === guestId)!.seat;
    const hostSeat = roomBeforeStart.players.find((p) => p.id === hostId)!.seat;

    const guestViewBefore = await getLatestMessage(guestPage, 'game.view');
    expect(guestViewBefore?.view.you?.id).toBe(guestId);
    expect(guestViewBefore?.view.you?.seat).toBe(guestSeatBefore);
    const holeCardsBefore = guestViewBefore!.view.you!.holeCards;
    expect(holeCardsBefore.length).toBe(2);

    // Kept from before the reload — nothing changes it until we submit an
    // action below, so it still describes exactly who's to act right now.
    const viewBeforeReload = (await getLatestMessage(hostPage, 'game.view'))!.view;

    await guestPage.reload();
    // A full reload wipes every in-page JS variable, including the
    // AppStore — the client always starts back at the username screen (see
    // app/store.ts's initialState()). Resuming the same session happens via
    // the resumeToken already sitting in sessionStorage, which reload does
    // NOT clear (see app/connection.ts's safeSessionStorage() doc comment).
    await enterUsername(guestPage, 'Guest');

    const helloOkAfterReload = await waitForMessage<HelloOkMessage>(guestPage, (m) => m.t === 'hello.ok');
    expect(helloOkAfterReload.playerId).toBe(guestId); // same PlayerId reclaimed — not a fresh session

    const roomAfterReload = await waitForPlayerCount(guestPage, 2);
    expect(roomAfterReload.phase).toBe('playing'); // resumed straight into the same in-progress game
    expect(roomAfterReload.players.find((p) => p.id === guestId)?.seat).toBe(guestSeatBefore); // same seat
    await waitForTableScreen(guestPage);

    // Nudge the hand forward by exactly one legal, hand-continuing action
    // (never a fold/all-in, which could end the hand and trigger a fresh
    // deal — see this file's header comment) so the reconnected guest
    // finally gets a game.view fan-out.
    const actingSeat = viewBeforeReload.actingSeat;
    expect(actingSeat).not.toBeNull();
    const actingPlayer = viewBeforeReload.players.find((p) => p.seat === actingSeat)!;
    const actingPage = actingSeat === hostSeat ? hostPage : guestPage;
    const action =
      actingPlayer.committedRound < viewBeforeReload.currentBet ? ({ type: 'call' } as const) : ({ type: 'check' } as const);
    await sendClientMessage(actingPage, { t: 'game.action', action });

    const guestViewAfter = await waitForMessage<GameViewMessage>(guestPage, (m) => m.t === 'game.view');
    expect(guestViewAfter.view.you?.id).toBe(guestId);
    expect(guestViewAfter.view.you?.seat).toBe(guestSeatBefore);
    expect(guestViewAfter.view.you?.holeCards).toEqual(holeCardsBefore); // SAME hidden hand — not a fresh deal
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
