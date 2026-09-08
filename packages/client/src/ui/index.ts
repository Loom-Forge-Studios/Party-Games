// DOM overlay — owned by A4 (Wave 1). See docs/ARCHITECTURE.md §1: "ui —
// 2D/DOM overlay ... Renders RoomState, never game rules." Everything here
// is a pure function of AppState/RoomState (@party/app, @party/protocol);
// nothing in this directory keeps its own copy of server-authoritative
// state.

export { mountAppShell } from './appShell.js';
export type { AppShellOptions } from './appShell.js';
export { renderConnectionStatus } from './connectionStatus.js';
export { el, clear } from './dom.js';
export type { ElAttrs, ElChild } from './dom.js';
export { renderUsernameScreen } from './screens/usernameScreen.js';
export type { UsernameScreenProps } from './screens/usernameScreen.js';
export { renderMenuScreen } from './screens/menuScreen.js';
export type { MenuScreenProps } from './screens/menuScreen.js';
export { renderLobbyScreen } from './screens/lobbyScreen.js';
export type { LobbyScreenProps } from './screens/lobbyScreen.js';
export { renderTableHandoffScreen } from './screens/tableHandoffScreen.js';
export { ensureStylesInjected } from './styles.js';
