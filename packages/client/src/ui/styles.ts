// Injects the DOM-overlay stylesheet once. This overlay sits above the 3D
// canvas (see docs/ARCHITECTURE.md §1 "ui — 2D/DOM overlay ... never game
// rules") — it never renders anything in-3D. Kept as one small stylesheet
// (no CSS-in-JS runtime, no build-time CSS pipeline) so the client stays
// light on modest hardware.
//
// Layout is fluid (flex + %/rem units, no fixed large widths) and verified
// to stay usable down to a 360px-wide viewport — the narrowest common phone
// width — per this wave's DoD.

const STYLE_ID = 'pg-ui-styles';

export function ensureStylesInjected(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

const CSS = `
.pg-app {
  --pg-bg: #14161b;
  --pg-panel: #1d2129;
  --pg-panel-2: #262b35;
  --pg-border: #333944;
  --pg-fg: #e8eaed;
  --pg-fg-dim: #9aa2ad;
  --pg-accent: #5b9dff;
  --pg-danger: #ff6b6b;
  --pg-ok: #4cd28a;
  --pg-warn: #e0b64c;
  /* Overlays above the 3D canvas (docs/ARCHITECTURE.md §1: "ui — 2D/DOM
     overlay ... never in-3D") rather than participating in normal document
     flow next to it, so it keeps working once A5's table/ mounts a
     full-viewport <canvas> behind #app-canvas. */
  position: fixed;
  inset: 0;
  z-index: 10;
  overflow-y: auto;
  box-sizing: border-box;
  width: 100%;
  min-height: 100%;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--pg-fg);
  background: transparent;
  display: flex;
  flex-direction: column;
}
.pg-app *, .pg-app *::before, .pg-app *::after {
  box-sizing: border-box;
}
.pg-status-host {
  flex: none;
}
.pg-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  color: var(--pg-fg-dim);
  background: var(--pg-bg);
  border-bottom: 1px solid var(--pg-border);
}
.pg-status__dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: var(--pg-fg-dim);
  flex: none;
}
.pg-status--open .pg-status__dot { background: var(--pg-ok); }
.pg-status--connecting .pg-status__dot,
.pg-status--reconnecting .pg-status__dot { background: var(--pg-warn); }
.pg-status--closed .pg-status__dot { background: var(--pg-danger); }

.pg-screen-host {
  flex: 1 1 auto;
  min-width: 0;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.pg-screen {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 30rem;
  margin: 0 auto;
}
.pg-screen h1 {
  font-size: 1.25rem;
  margin: 0 0 0.25rem;
}
.pg-screen h2 {
  font-size: 1rem;
  margin: 0 0 0.25rem;
}
.pg-panel {
  background: var(--pg-panel);
  border: 1px solid var(--pg-border);
  border-radius: 0.5rem;
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}
label {
  font-size: 0.85rem;
  color: var(--pg-fg-dim);
}
input, select {
  width: 100%;
  min-height: 2.5rem;
  padding: 0.4rem 0.6rem;
  font-size: 1rem;
  border-radius: 0.4rem;
  border: 1px solid var(--pg-border);
  background: var(--pg-panel-2);
  color: var(--pg-fg);
}
input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible {
  outline: 2px solid var(--pg-accent);
  outline-offset: 2px;
}
.pg-button {
  min-height: 2.5rem;
  padding: 0.5rem 1rem;
  font-size: 1rem;
  border-radius: 0.4rem;
  border: 1px solid var(--pg-border);
  background: var(--pg-panel-2);
  color: var(--pg-fg);
  cursor: pointer;
}
.pg-button--primary {
  background: var(--pg-accent);
  border-color: var(--pg-accent);
  color: #0a0e14;
  font-weight: 600;
}
.pg-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pg-button--danger {
  color: var(--pg-danger);
  border-color: var(--pg-danger);
}
.pg-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.pg-error {
  color: var(--pg-danger);
  font-size: 0.85rem;
  margin: 0;
}
.pg-hint {
  color: var(--pg-fg-dim);
  font-size: 0.85rem;
  margin: 0;
}
.pg-room-code {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.15em;
}
.pg-player-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.pg-player-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.4rem 0.5rem;
  border-radius: 0.35rem;
  background: var(--pg-panel-2);
}
.pg-player-row[data-connected="false"] {
  opacity: 0.55;
}
.pg-player-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.pg-badge {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  background: var(--pg-panel);
  border: 1px solid var(--pg-border);
  color: var(--pg-fg-dim);
}
.pg-badge--host {
  color: var(--pg-warn);
  border-color: var(--pg-warn);
}
.pg-player-row .pg-button {
  margin-left: auto;
  min-height: 2rem;
  padding: 0.25rem 0.6rem;
  font-size: 0.85rem;
}

@media (max-width: 420px) {
  .pg-screen-host { padding: 0.6rem; }
  .pg-panel { padding: 0.6rem; }
}
`;
