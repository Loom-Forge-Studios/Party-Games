import { test, expect } from '@playwright/test';
import { installWsCaptureOn } from '../support/ws-capture.js';
import { enterUsername } from '../support/lobby-flow.js';

// Real coverage now lives in checkers-full-game.spec.ts, kick-player.spec.ts,
// reload-resume.spec.ts and start-blocked.spec.ts (see docs/ARCHITECTURE.md's
// account of Wave 2 landing real games/presenters). This file stays a fast,
// narrowly-scoped canary: does the real client (packages/client, via Vite
// dev) actually boot and successfully complete a `hello` round trip against
// the real server (packages/server) — i.e. is playwright.config.ts's
// webServer wiring itself healthy — independent of any lobby/game logic.
test('the real client boots, connects to the real server, and reaches the menu', async ({ page }) => {
  await installWsCaptureOn(page);
  await page.goto('/');

  await enterUsername(page, 'Smoke');

  await expect(page.getByTestId('menu-screen')).toBeVisible();
});
