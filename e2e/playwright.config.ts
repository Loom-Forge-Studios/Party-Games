import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Owned by A11. Spawns the REAL server (packages/server) and the REAL
// client (packages/client, via Vite dev) as actual child processes for the
// test run, then drives them the same way a real browser session would:
// real BrowserContexts, real WebSocket connections, no mocks anywhere in
// the stack.
//
// Ports are NOT configurable here beyond what packages/client/vite.config.ts
// already hardcodes: its dev server listens on 5173 and its `/ws`+`/healthz`
// proxy target is hardcoded to `http://localhost:8080` (see that file's own
// comment — same-origin `/ws`, matching production's Caddy reverse-proxy
// per docs/ARCHITECTURE.md §1). So the server here MUST run on 8080 (its
// default anyway — see packages/server/src/index.ts's `PORT` env var) for
// the client's proxy to reach it; this config doesn't invent its own port
// scheme on top of an assumption baked into a package this wave doesn't own.
//
// `just build` (packages/*'s `tsc -b`) always runs before `just e2e` (see
// justfile's `verify` recipe and .github/workflows/ci.yml, which must stay
// in sync with it) — both the server and client depend on every
// @party/game-* package's compiled dist/ output, which only `build`
// produces. Running this config directly without a prior build (e.g. a
// completely fresh checkout) will fail for the same reason `npm run dev`
// would on a fresh checkout; that's an existing repo-wide constraint, not
// something specific to this config.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const SERVER_PORT = 8080;
const CLIENT_PORT = 5173;

// Fixed (not Date.now()-derived) so every local/CI run seeds each room's
// game identically — see packages/server/src/host/host-manager.ts's
// HostManagerOptions.seed doc comment and packages/server/src/index.ts's
// SERVER_SEED wiring. Checkers itself has no randomness at all (see
// packages/games/checkers/src/module.ts), so this mostly matters for
// scenario 3's Hold'em hand — though even there, the assertions this suite
// makes are about *consistency* (same seat, same hole cards, before and
// after a reload) rather than any specific dealt card, so they'd hold for
// any seed. Fixed anyway, per the assignment's "Deterministic: use
// SERVER_SEED" instruction and so a reproduced failure is reproducible.
const SERVER_SEED = '20260908';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'party-server',
      command: 'npm run dev --workspace=@party/server',
      cwd: repoRoot,
      url: `http://localhost:${SERVER_PORT}/healthz`,
      env: { ...process.env, PORT: String(SERVER_PORT), SERVER_SEED },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      name: 'party-client',
      command: 'npm run dev --workspace=@party/client',
      cwd: repoRoot,
      url: `http://localhost:${CLIENT_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
