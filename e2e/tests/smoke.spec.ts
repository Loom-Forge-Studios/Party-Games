import { test, expect } from '@playwright/test';

// STUB ONLY — owned by A11 (Wave 1). There's no real app to test against
// yet (packages/client and packages/server are Wave 1 stubs), so this just
// proves the Playwright harness itself works end-to-end: a browser launches,
// navigates, and closes cleanly. CI's e2e step must run and pass, not be
// skipped — this is that placeholder. Replace with real lobby/game
// coverage once packages/client has something to click on.
test('playwright harness launches a browser and can navigate', async ({ page }) => {
  await page.goto('about:blank');
  expect(await page.title()).toBe('');
});
