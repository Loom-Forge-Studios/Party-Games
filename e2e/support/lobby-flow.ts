// Owned by A11. Real UI-driven helpers for the part of every scenario that
// IS naturally a browser interaction (username -> create/join -> start) —
// see docs/ARCHITECTURE.md §1 and packages/client/src/ui/screens/* for the
// data-testids these rely on. In-game move driving deliberately does NOT
// go through here — see ws-capture.ts and checkers-bot.ts for why.
import { expect, type Page } from '@playwright/test';
import type { GameId, RoomState, ServerMessage } from '@party/protocol';
import { getLatestMessage, waitForMessage } from './ws-capture.js';

type RoomStateMessage = Extract<ServerMessage, { t: 'room.state' }>;

/** Fills the username screen and submits it — works both for a fresh session and for the re-submit a reload requires (see connection.ts: the client always starts back at the username screen, resume happens via the resumeToken already sitting in sessionStorage). */
export async function enterUsername(page: Page, username: string): Promise<void> {
  const input = page.getByTestId('username-input');
  await expect(input).toBeVisible();
  await input.fill(username);
  await page.getByTestId('username-submit').click();
}

export interface CreateRoomOptions {
  gameId: GameId;
  maxPlayers: number;
}

/** From the menu screen: selects a game + player count and creates a room. Returns the resulting room code once the host's own room.state confirms creation. */
export async function createRoom(page: Page, opts: CreateRoomOptions): Promise<string> {
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  await page.getByTestId('create-game-select').selectOption(opts.gameId);
  await page.getByTestId('create-max-players-select').selectOption(String(opts.maxPlayers));
  await page.getByTestId('create-room-submit').click();

  await waitForMessage(page, (m) => m.t === 'room.state' && m.room.players.length === 1);
  await expect(page.getByTestId('room-code')).toBeVisible();
  return page.getByTestId('room-code').innerText();
}

/** From the menu screen: joins an existing room by its 4-char code. */
export async function joinRoom(page: Page, roomId: string): Promise<void> {
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  await page.getByTestId('join-code-input').fill(roomId);
  await page.getByTestId('join-room-submit').click();
  await expect(page.getByTestId('lobby-screen')).toBeVisible();
}

/** Waits until this page's own room.state reports exactly `count` players (e.g. after everyone has joined). Returns that RoomState. */
export async function waitForPlayerCount(page: Page, count: number): Promise<RoomState> {
  const msg = await waitForMessage<RoomStateMessage>(
    page,
    (m) => m.t === 'room.state' && m.room.players.length === count,
  );
  return msg.room;
}

/** Host-only: clicks Start once the lobby reports startable. */
export async function startRoom(page: Page): Promise<void> {
  const startButton = page.getByTestId('start-button');
  await expect(startButton).toBeEnabled();
  await startButton.click();
}

/** Waits until this page's client has made the lobby->table handoff (RoomState.phase left 'lobby'). */
export async function waitForTableScreen(page: Page): Promise<void> {
  await waitForMessage(page, (m) => m.t === 'room.state' && m.room.phase !== 'lobby');
  await expect(page.getByTestId('table-handoff-screen')).toBeVisible();
}

/** This page's own playerId, from the `hello.ok` every Connection sends immediately after opening its socket. */
export async function getOwnPlayerId(page: Page): Promise<string> {
  const helloOk = await getLatestMessage(page, 'hello.ok');
  if (!helloOk) throw new Error('getOwnPlayerId: no hello.ok observed yet on this page');
  return helloOk.playerId;
}
