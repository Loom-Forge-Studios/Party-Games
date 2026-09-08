import { test, expect } from '@playwright/test';
import { getLatestMessage, installWsCaptureOn, sendClientMessage, waitForMessage } from '../support/ws-capture.js';
import {
  createRoom,
  enterUsername,
  getOwnPlayerId,
  joinRoom,
  waitForPlayerCount,
} from '../support/lobby-flow.js';

// Scenario 2 from the A11 brief. What this test can honestly assert, given
// the real merged codebase (verified with a raw WebSocket probe against the
// real server during development — see the note below): the host-side kick
// is fully real and server-authoritative. What it can NOT assert — because
// the behavior genuinely does not exist anywhere in packages/server or
// packages/client today — is "the kicked client is ejected cleanly, returns
// to the menu". That's a real product gap outside e2e/'s ownership; see
// this PR's description for the concrete fix pointer.
//
// KNOWN GAP: packages/server/src/rooms/room-manager.ts's kickPlayer() calls
// removePlayer(), whose only side effect on other clients is
// broadcastState(room) using the room's POST-removal player list — the
// kicked player's own socket is never sent anything at all (not a
// room.state, not an error, nothing). Their client is left rendering the
// stale pre-kick lobby forever; packages/client/src/app/store.ts's `error`
// handling never changes `screen`, and there is no other code anywhere in
// packages/client that reacts to "I've been kicked". Fixing this needs
// changes in packages/server (rooms/host) and packages/client (app/store,
// ui/appShell) — outside e2e/'s ownership — so this test locks in the real,
// currently-guaranteed contract instead of a false-passing assertion of
// behavior that doesn't exist.
test('host kicks a player: the room updates for everyone still in it, and the kicked player is genuinely evicted server-side', async ({
  browser,
}) => {
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

    const roomId = await createRoom(hostPage, { gameId: 'checkers', maxPlayers: 2 });
    await joinRoom(guestPage, roomId);

    await waitForPlayerCount(hostPage, 2);
    await waitForPlayerCount(guestPage, 2);

    const guestId = await getOwnPlayerId(guestPage);

    await hostPage.getByTestId(`kick-button-${guestId}`).click();

    // Fully implemented: the host (and any other remaining player) sees the
    // roster correctly drop to 1, with seats compacted.
    const roomAfterKick = await waitForPlayerCount(hostPage, 1);
    expect(roomAfterKick.players.map((p) => p.id)).not.toContain(guestId);
    expect(roomAfterKick.players[0]!.seat).toBe(0);

    // The guest's own last-received room.state is still the stale, pre-kick
    // 2-player roster — proof the gap described above is real, not a race
    // in this test (no room.state was ever addressed to them after the kick).
    const guestLastRoomState = await getLatestMessage(guestPage, 'room.state');
    expect(guestLastRoomState?.room.players).toHaveLength(2);

    // But server-side, the guest's session genuinely no longer belongs to
    // any room: sent through their own real, still-open WebSocket (not the
    // UI's "Leave room" button, which optimistically calls
    // AppStore.returnToMenu() regardless of the server's response and would
    // mask this check), a room-scoped message is rejected.
    await sendClientMessage(guestPage, { t: 'room.leave' });
    const rejection = await waitForMessage(guestPage, (m) => m.t === 'error' && m.code === 'ROOM_NOT_FOUND');
    expect(rejection).toBeDefined();
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
