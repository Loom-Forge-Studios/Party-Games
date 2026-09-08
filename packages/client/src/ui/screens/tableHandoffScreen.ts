import { el } from '../dom.js';

/**
 * Rendered for the brief moment between `RoomState.phase` leaving 'lobby'
 * and the 3D table/game presenter (A5/A6, later per-game presenters)
 * actually mounting into the canvas. This is the clean handoff point this
 * wave's DoD asks for: `AppStore` flips `screen` to `'table'` on the same
 * `room.state` message that reports `phase !== 'lobby'`, and
 * `mountAppShell`'s `onTableHandoff` callback fires exactly once for that
 * transition (see packages/client/src/ui/appShell.ts) — nothing else in
 * this package tries to render the game itself.
 */
export function renderTableHandoffScreen(): HTMLElement {
  return el('div', { class: 'pg-screen', 'data-testid': 'table-handoff-screen', role: 'status', 'aria-live': 'polite' }, [
    el('p', { class: 'pg-hint' }, ['Entering the table…']),
  ]);
}
