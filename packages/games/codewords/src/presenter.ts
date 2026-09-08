// Codewords presenter — owned by A10 (Wave 2). The client-side counterpart
// to module.ts: turns CodewordsView into a 3D 5x5 tile grid and GameEvents
// into animation + camera focus hints, and turns player input into
// ctx.emit() calls. Implements no rules — no move validation, no
// win-condition checks; see docs/ARCHITECTURE.md §6/§7 for that split.
//
// This is the ONLY file in this package allowed to import 'three' or
// '@party/client' — module.ts/index.ts (the rules) must stay Three.js-free
// so they're testable headlessly. See this package's package.json.

import * as THREE from 'three';
import type { PresenterCtx } from '@party/client';
import type { GameEvent } from '@party/engine';
import type { GameId } from '@party/protocol';
import { GRID_SIZE } from './module.js';
import type { CodewordsView, CodewordsTileView, TileColor } from './module.js';

/** Same shape as docs/ARCHITECTURE.md §6's GamePresenter — no shared type to import yet (see this wave's brief), so it's satisfied structurally here. */
export interface GamePresenter<V = unknown> {
  gameId: GameId;
  mount(ctx: PresenterCtx): Promise<void>;
  renderView(view: V): void;
  playEvent(ev: GameEvent): Promise<void>;
  unmount(): void;
}

const TILE_SIZE = 0.15;
const TILE_GAP = 0.02;
const SPACING = TILE_SIZE + TILE_GAP;
const TILE_HEIGHT = 0.018;
const LABEL_Y_OFFSET = TILE_HEIGHT / 2 + 0.001;
const KEY_RING_Y_OFFSET = 0.001;

const HIDDEN_COLOR = 0xe4d9bd; // face-down parchment
const TILE_COLORS: Record<TileColor, number> = {
  team0: 0x3b6fd4,
  team1: 0xc0392b,
  neutral: 0xa8a495,
  assassin: 0x1b1b1b,
};
const CLUE_PANEL_COLOR = 0x1f2933;

/** Same fallback pattern as packages/assets/src/procedural/canvas.ts: real canvas in a browser, absent under plain Node (this package's own vitest run) — degrade to a flat colour instead of throwing. */
function canvasAvailable(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** Draws `text` centred on a small canvas over `bgColor` and returns a texture, or a flat-colour fallback with no canvas available. */
function buildLabelTexture(text: string, bgColor: string, textColor = '#1a1a1a'): THREE.Texture {
  const size = 128;
  if (canvasAvailable()) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = textColor;
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      wrapText(ctx, text.toUpperCase(), size / 2, size / 2, size - 16, 22);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    }
  }
  const data = new Uint8Array(4);
  const [r, g, b] = hexToRgb(bgColor);
  data.set([r, g, b, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}

function colorToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

interface TileVisual {
  group: THREE.Group;
  body: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  keyRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  lastWord: string | null;
  lastRevealed: boolean;
  lastColor: TileColor | undefined;
}

/** Grid-relative world offset for a tile, centred on the table origin (row/col both 0..GRID_SIZE-1). */
function tileOffset(row: number, col: number): { x: number; z: number } {
  const mid = (GRID_SIZE - 1) / 2;
  return { x: (col - mid) * SPACING, z: (row - mid) * SPACING };
}

/**
 * Renders CodewordsView as a 5x5 grid of tiles on the shared table, plus a
 * clue display. Colour-reveals a tile on `tile.revealed`; shows the
 * spymaster-only key by simply trusting view()'s per-viewer filtering —
 * `t.color` is present on a tile view if and only if the local player is
 * entitled to see it (spymaster, or the tile is already revealed), so
 * "only render the key overlay for the local team's spymaster" falls out
 * of that filtering for free — this file never re-derives who's a
 * spymaster from role bookkeeping of its own.
 */
export class CodewordsPresenter implements GamePresenter<CodewordsView> {
  readonly gameId: GameId = 'codewords';

  private ctx: PresenterCtx | null = null;
  private readonly tiles = new Map<string, TileVisual>();
  private cluePanel: THREE.Group | null = null;
  private clueLabel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private lastClueText = '';
  private lastView: CodewordsView | null = null;

  async mount(ctx: PresenterCtx): Promise<void> {
    this.ctx = ctx;

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const id = `tile-${row}-${col}`;
        const visual = this.buildTileVisual(id);
        const { x, z } = tileOffset(row, col);
        visual.group.position.set(x, 0, z);
        ctx.table.add(visual.group);
        this.tiles.set(id, visual);
      }
    }

    this.cluePanel = new THREE.Group();
    this.cluePanel.name = 'codewords-clue-panel';
    const panelGeometry = new THREE.PlaneGeometry(0.5, 0.14);
    const panelMaterial = new THREE.MeshBasicMaterial({ color: CLUE_PANEL_COLOR, transparent: true, opacity: 0.85 });
    const panelMesh = new THREE.Mesh(panelGeometry, panelMaterial);
    panelMesh.rotation.x = -Math.PI / 2;
    this.cluePanel.add(panelMesh);

    const labelGeometry = new THREE.PlaneGeometry(0.48, 0.12);
    const labelMaterial = new THREE.MeshBasicMaterial({ map: buildLabelTexture('', colorToCss(CLUE_PANEL_COLOR), '#f5f5f5'), transparent: true });
    this.clueLabel = new THREE.Mesh(labelGeometry, labelMaterial);
    this.clueLabel.rotation.x = -Math.PI / 2;
    this.clueLabel.position.y = 0.001;
    this.cluePanel.add(this.clueLabel);

    const boardHalf = ((GRID_SIZE - 1) / 2) * SPACING + TILE_SIZE / 2;
    this.cluePanel.position.set(0, TILE_HEIGHT + 0.01, -(boardHalf + 0.18));
    ctx.table.add(this.cluePanel);
  }

  private buildTileVisual(id: string): TileVisual {
    const group = new THREE.Group();
    group.name = id; // scene object id — this is what tile.revealed / assassin.hit focus hints target.

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE),
      new THREE.MeshStandardMaterial({ color: HIDDEN_COLOR, roughness: 0.7 }),
    );
    body.position.y = TILE_HEIGHT / 2;
    group.add(body);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE_SIZE * 0.92, TILE_SIZE * 0.92),
      new THREE.MeshBasicMaterial({ map: buildLabelTexture('', colorToCss(HIDDEN_COLOR)), transparent: true }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.y = LABEL_Y_OFFSET;
    group.add(label);

    // Thin ring under the tile, coloured with the *true* colour when the
    // viewer's filtered CodewordsView happens to include it (spymaster, or
    // already revealed) — invisible otherwise. This is a render-time
    // convenience only; the actual secrecy boundary is view() itself.
    const keyRing = new THREE.Mesh(
      new THREE.RingGeometry(TILE_SIZE * 0.42, TILE_SIZE * 0.5, 24),
      new THREE.MeshBasicMaterial({ color: TILE_COLORS.neutral, transparent: true, opacity: 0 }),
    );
    keyRing.rotation.x = -Math.PI / 2;
    keyRing.position.y = KEY_RING_Y_OFFSET;
    group.add(keyRing);

    return { group, body, label, keyRing, lastWord: null, lastRevealed: false, lastColor: undefined };
  }

  renderView(view: CodewordsView): void {
    this.lastView = view;
    for (const t of view.tiles) {
      this.renderTile(t);
    }
    this.renderCluePanel(view);
  }

  private renderTile(t: CodewordsTileView): void {
    const visual = this.tiles.get(t.id);
    if (!visual) return; // unknown id — presenter/module id scheme drifted; render nothing rather than throw.

    if (visual.lastWord !== t.word) {
      visual.label.material.map = buildLabelTexture(t.word, t.revealed ? colorToCss(TILE_COLORS[t.color!]) : colorToCss(HIDDEN_COLOR));
      visual.label.material.needsUpdate = true;
      visual.lastWord = t.word;
    }

    if (visual.lastRevealed !== t.revealed || visual.lastColor !== t.color) {
      const bodyColor = t.revealed && t.color ? TILE_COLORS[t.color] : HIDDEN_COLOR;
      visual.body.material.color.setHex(bodyColor);
      if (visual.lastRevealed !== t.revealed) {
        visual.label.material.map = buildLabelTexture(t.word, colorToCss(bodyColor));
        visual.label.material.needsUpdate = true;
      }
      visual.lastRevealed = t.revealed;
      visual.lastColor = t.color;
    }

    // Spymaster-only key: `t.color` is only ever present (per view()'s
    // filtering) when the local viewer is a spymaster, or the tile is
    // already revealed. Show the ring only for the still-hidden case —
    // once revealed, the tile body itself already carries the colour.
    const showKey = !t.revealed && t.color !== undefined;
    visual.keyRing.material.opacity = showKey ? 0.9 : 0;
    if (showKey && t.color) {
      visual.keyRing.material.color.setHex(TILE_COLORS[t.color]);
    }
  }

  private renderCluePanel(view: CodewordsView): void {
    if (!this.clueLabel) return;
    const text = view.clue ? `${view.clue.word} — ${view.clue.count}` : turnStatusText(view);
    if (text === this.lastClueText) return;
    this.lastClueText = text;
    this.clueLabel.material.map = buildLabelTexture(text, colorToCss(CLUE_PANEL_COLOR), '#f5f5f5');
    this.clueLabel.material.needsUpdate = true;
  }

  async playEvent(ev: GameEvent): Promise<void> {
    const ctx = this.ctx;
    if (ctx && ev.focus) {
      await ctx.camera.focus(ev.focus);
    }
    // No per-event mesh mutation beyond what renderView() already did —
    // the server always sends a fresh game.view alongside game.events (see
    // docs/ARCHITECTURE.md §3), and renderView() is idempotent, so the
    // grid is already showing this event's result by the time playEvent
    // runs. playEvent's whole job here is timing: hold the camera on the
    // thing that just happened before the next event (or the view's home
    // return) proceeds.
  }

  /** Called by the input layer (not built this wave — see docs/ARCHITECTURE.md §6) when the local player clicks a tile mesh (`tile.id === group.name`). A no-op unless it's currently this player's turn to guess. */
  handleTileClick(tileId: string): void {
    const ctx = this.ctx;
    const view = this.lastView;
    if (!ctx || !view) return;
    if (view.phase !== 'guess' || view.you.role !== 'guesser' || view.you.team !== view.turnTeam) return;
    ctx.emit({ type: 'tile.guess', tileId });
  }

  /** Called by the (not-yet-built) clue-input UI when the local spymaster submits a clue. */
  handleClueSubmit(word: string, count: number): void {
    const ctx = this.ctx;
    const view = this.lastView;
    if (!ctx || !view) return;
    if (view.phase !== 'clue' || view.you.role !== 'spymaster' || view.you.team !== view.turnTeam) return;
    ctx.emit({ type: 'clue.give', word, count });
  }

  /** Called by the (not-yet-built) HUD when the local guesser chooses to stop guessing early. */
  handlePass(): void {
    const ctx = this.ctx;
    const view = this.lastView;
    if (!ctx || !view) return;
    if (view.phase !== 'guess' || view.you.role !== 'guesser' || view.you.team !== view.turnTeam) return;
    ctx.emit({ type: 'turn.pass' });
  }

  unmount(): void {
    const ctx = this.ctx;
    for (const visual of this.tiles.values()) {
      ctx?.table.remove(visual.group);
      visual.body.geometry.dispose();
      visual.body.material.dispose();
      visual.label.geometry.dispose();
      visual.label.material.map?.dispose();
      visual.label.material.dispose();
      visual.keyRing.geometry.dispose();
      visual.keyRing.material.dispose();
    }
    this.tiles.clear();

    if (this.cluePanel) {
      ctx?.table.remove(this.cluePanel);
      this.cluePanel.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const material = obj.material as THREE.MeshBasicMaterial;
          material.map?.dispose();
          material.dispose();
        }
      });
      this.cluePanel = null;
      this.clueLabel = null;
    }

    this.lastView = null;
    this.lastClueText = '';
    this.ctx = null;
  }
}

function turnStatusText(view: CodewordsView): string {
  if (view.phase === 'ended') {
    return view.endReason === 'assassin' ? 'assassin — game over' : 'all words found — game over';
  }
  const teamLabel = `team ${view.turnTeam + 1}`;
  return view.phase === 'clue' ? `${teamLabel} — awaiting clue` : `${teamLabel} — guessing`;
}

export function createCodewordsPresenter(): CodewordsPresenter {
  return new CodewordsPresenter();
}
