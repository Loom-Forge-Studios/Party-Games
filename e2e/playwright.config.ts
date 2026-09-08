import { defineConfig, devices } from '@playwright/test';

// STUB ONLY — owned by A11 (Wave 1). Once the client (packages/client) and
// server (packages/server) are real, add a `webServer` block here to boot
// them for the test run, and grow tests/ into real lobby/game coverage.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
