// Owned by A11. Lets a Playwright test observe every `ServerMessage` the
// real client receives, and send raw `ClientMessage`s through the SAME
// authenticated WebSocket the client already opened — without touching a
// single line of packages/client's source.
//
// This is exactly the approach the assignment brief suggests: drive a full
// game "by directly issuing WebSocket-level game.action messages through
// the page's own connection" rather than needing real per-move UI
// automation. We patch the *browser's* global `WebSocket` constructor via
// `page.addInitScript` before the app's own bootstrap script ever runs, so
// `packages/client/src/app/connection.ts`'s `new WebSocket(url)` call
// picks up our capturing subclass transparently — the real client's
// reconnect/backoff/session logic is completely unmodified and still runs
// for real. The subclass both forwards to the native WebSocket (so the
// real client keeps working exactly as shipped) and mirrors every parsed
// inbound message into `window.__pgMessages`, which the helpers below poll
// via `page.waitForFunction` — a real condition on real server traffic,
// never a fixed `page.waitForTimeout`.
import type { Page } from '@playwright/test';
import type { ClientMessage, ServerMessage } from '@party/protocol';

declare global {
  interface Window {
    __pgSockets: Array<{ url: string; ws: WebSocket }>;
    __pgMessages: ServerMessage[];
  }
}

/** Runs inside the page (via addInitScript) — must be fully self-contained, no closed-over references. */
function installWsCapture(): void {
  const NativeWebSocket = window.WebSocket;
  window.__pgSockets = [];
  window.__pgMessages = [];

  class CapturingWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      window.__pgSockets.push({ url: String(url), ws: this });
      this.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return;
        try {
          window.__pgMessages.push(JSON.parse(ev.data));
        } catch {
          // Not JSON — the real Connection.parseServerMessage would drop this too.
        }
      });
    }
  }

  window.WebSocket = CapturingWebSocket;
}

/** Call once per Page, before its first `goto` — an init script applies to every subsequent navigation on that page, reload included, so it survives scenario 3's mid-game reload. */
export async function installWsCaptureOn(page: Page): Promise<void> {
  await page.addInitScript(installWsCapture);
}

/** All ServerMessages this page's real Connection has received since the last navigation/reload. */
export async function getMessages(page: Page): Promise<ServerMessage[]> {
  return page.evaluate(() => window.__pgMessages ?? []);
}

/** The most recent ServerMessage of type `t` this page has received, if any. */
export async function getLatestMessage<T extends ServerMessage['t']>(
  page: Page,
  t: T,
): Promise<Extract<ServerMessage, { t: T }> | undefined> {
  const messages = await getMessages(page);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.t === t) return messages[i] as Extract<ServerMessage, { t: T }>;
  }
  return undefined;
}

/**
 * Waits for a ServerMessage matching `predicate` to appear, polling the
 * real captured traffic — never a fixed sleep: this returns the instant a
 * matching message has arrived, and only ever throws if none has after
 * `timeoutMs` (a real failure, not a race). `predicate` runs on the Node
 * side (via repeated `getMessages()` reads), not inside the page, so —
 * unlike a `page.waitForFunction` predicate — it's a completely ordinary
 * JS closure and may freely reference outer variables (a room id, a
 * player id, a `count`, ...).
 */
export async function waitForMessage<T = ServerMessage>(
  page: Page,
  predicate: (msg: ServerMessage) => boolean,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const messages = await getMessages(page);
    const found = messages.find(predicate);
    if (found !== undefined) return found as T;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForMessage: timed out after ${timeoutMs}ms waiting for a matching ServerMessage (${messages.length} messages observed on this page so far)`,
      );
    }
    await page.waitForTimeout(pollIntervalMs);
  }
}

/** True once a message matching `predicate` has already arrived (no waiting). */
export async function hasMessage(page: Page, predicate: (msg: ServerMessage) => boolean): Promise<boolean> {
  const messages = await getMessages(page);
  return messages.some(predicate);
}

/**
 * Sends a raw ClientMessage through this page's own live, authenticated
 * WebSocket connection — the same one packages/client/src/app/connection.ts
 * opened via `hello`/`resumeToken`. Used to drive `game.action`s
 * programmatically (see this file's header comment) and, in the kick
 * scenario, to prove server-side rejection independent of what the UI
 * currently renders.
 */
export async function sendClientMessage(page: Page, message: ClientMessage): Promise<void> {
  await page.evaluate((msg) => {
    const sockets = window.__pgSockets ?? [];
    // Walk from the most recently constructed socket backwards — a reload
    // or reconnect creates a new one, and the old one's readyState is no
    // longer OPEN (readyState 1 per the WebSocket spec).
    const entry = [...sockets].reverse().find((e) => e.ws.readyState === 1);
    if (!entry) throw new Error('sendClientMessage: no open WebSocket found on this page');
    entry.ws.send(JSON.stringify(msg));
  }, message);
}
