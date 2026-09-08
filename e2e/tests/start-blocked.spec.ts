import { test, expect } from '@playwright/test';
import { installWsCaptureOn, sendClientMessage, waitForMessage } from '../support/ws-capture.js';
import { createRoom, enterUsername } from '../support/lobby-flow.js';

// Scenario 4 from the A11 brief: room.start is rejected below the selected
// game's minimum player count, both as a UI affordance (the Start button
// reflects RoomState.startable.reason) and as a real server-side rule (a
// message sent straight over the wire, bypassing the disabled button, is
// still rejected).
test('room.start is blocked below the minimum player count', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    await installWsCaptureOn(page);
    await page.goto('/');
    await enterUsername(page, 'Solo');

    // Checkers requires exactly 2 players (meta.minPlayers === meta.maxPlayers
    // === 2 — see packages/games/checkers/src/module.ts's GameMeta), so a lone
    // host is never startable.
    await createRoom(page, { gameId: 'checkers', maxPlayers: 2 });

    const startButton = page.getByTestId('start-button');
    await expect(startButton).toBeDisabled();
    await expect(page.getByTestId('start-disabled-reason')).toBeVisible();
    await expect(page.getByTestId('start-disabled-reason')).toContainText(/2/);

    // Bypass the disabled button and hit the protocol directly — proves the
    // rejection is enforced server-side (packages/server/src/rooms/room-manager.ts's
    // startRoom() via computeStartable()), not merely a client-side nicety a
    // modified/hostile client could skip.
    await sendClientMessage(page, { t: 'room.start' });
    const rejection = await waitForMessage(page, (m) => m.t === 'error' && m.code === 'BAD_PLAYER_COUNT');
    expect(rejection).toBeDefined();

    // The room never actually left 'lobby'.
    await expect(page.getByTestId('lobby-screen')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
