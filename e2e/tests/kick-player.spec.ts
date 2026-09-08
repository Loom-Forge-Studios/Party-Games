import { test, expect } from '@playwright/test';
import { installWsCaptureOn, waitForMessage } from '../support/ws-capture.js';
import {
  createRoom,
  enterUsername,
  getOwnPlayerId,
  joinRoom,
  waitForPlayerCount,
} from '../support/lobby-flow.js';

// Scenario 2 from the A11 brief.
//
// UPDATE (overseer): A11 originally found and documented a real gap here —
// a kicked player's own socket was never sent anything at all, so this test
// could only prove eviction indirectly (send a room-scoped message over the
// still-open socket afterward, and observe it get rejected). The overseer
// fixed the underlying gap: rooms/room-manager.ts's kickPlayer() now sends
// the target an `error` (code 'KICKED', a small additive ErrorCode — see
// packages/protocol/src/messages.ts) and closes their connection via
// Transport.disconnect(); app/store.ts now reacts to a KICKED error by
// returning to the menu screen. This test now asserts that real behavior
// directly instead of the old indirect proof.
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

    // The guest's own real socket receives the KICKED notification directly
    // from the server — not inferred from a side channel.
    const kickedMsg = await waitForMessage(guestPage, (m) => m.t === 'error' && m.code === 'KICKED');
    expect(kickedMsg).toBeDefined();

    // And the client actually reacts to it: back on the menu screen, not
    // stuck rendering the stale pre-kick lobby.
    await expect(guestPage.getByTestId('create-room-form')).toBeVisible();
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
