import { test, expect } from '@playwright/test';
import { getLatestMessage, installWsCaptureOn } from '../support/ws-capture.js';
import {
  createRoom,
  enterUsername,
  getOwnPlayerId,
  joinRoom,
  startRoom,
  waitForPlayerCount,
  waitForTableScreen,
} from '../support/lobby-flow.js';
import { mapSeatsToPages, playCheckersToGameOver } from '../support/checkers-bot.js';

// Scenario 1 from the A11 brief: two real BrowserContexts, each a real
// WebSocket connection to the real server (see playwright.config.ts),
// create/join/start a full Checkers game and drive it to game.over.
//
// Per the brief, the DoD here is "a full game reaches game.over", not
// pixel-perfect move clicking — so moves are submitted via
// checkersModule.defaultAction() (the same deterministic function
// packages/server/src/host/game-host.ts calls on a turn timeout) through
// each player's own real, authenticated WebSocket (see
// support/checkers-bot.ts and support/ws-capture.ts for why this is
// "driving the real connection", not a mock).
test('two players create/join/start a full Checkers game and reach game.over', async ({ browser }) => {
  // Overseer fix: a real self-play run of this deterministic game (see
  // checkers-bot.ts's header comment — Checkers has zero randomness, so
  // this is always exactly 45 plies) took ~56s wall-clock in one CI run
  // against the global 60s timeout and tipped over it in another — not a
  // stuck-game bug (playCheckersToGameOver's own maxPlies guard already
  // catches that class of failure and throws a distinct error), just the
  // harness's patience with real per-ply round-trip time under CI's
  // shared/noisy-neighbor scheduling. Raised with headroom rather than
  // widening any in-test assertion.
  test.setTimeout(180_000);

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
    const roomBeforeStart = await waitForPlayerCount(guestPage, 2);

    await startRoom(hostPage);
    await waitForTableScreen(hostPage);
    await waitForTableScreen(guestPage);

    // The real 3D table actually mounted — a WebGL canvas with no client-
    // side errors, matching how this platform was originally hand-verified
    // (see this repo's A11 brief).
    await expect(hostPage.locator('#app-canvas canvas')).toBeVisible();
    await expect(guestPage.locator('#app-canvas canvas')).toBeVisible();

    const hostId = await getOwnPlayerId(hostPage);
    const guestId = await getOwnPlayerId(guestPage);
    const pageByPlayerId = new Map([
      [hostId, hostPage],
      [guestId, guestPage],
    ]);
    const seats = mapSeatsToPages(roomBeforeStart, pageByPlayerId);

    const gameOver = await playCheckersToGameOver(hostPage, seats);

    expect(gameOver.result.reason.length).toBeGreaterThan(0);
    expect([...gameOver.result.winners].every((id) => id === hostId || id === guestId)).toBe(true);

    // Both real sockets were fanned out to identically — this isn't just
    // one client's local read of the truth.
    const guestGameOver = await getLatestMessage(guestPage, 'game.over');
    expect(guestGameOver?.result).toEqual(gameOver.result);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
