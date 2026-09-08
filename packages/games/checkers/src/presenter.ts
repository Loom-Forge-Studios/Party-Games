// The 3D presenter for Checkers — owned by A8. This is the ONLY file in
// this package allowed to import Three.js / @party/client (see
// docs/ARCHITECTURE.md §7's rules/presenter split; module.ts stays pure).
//
// KNOWN ASSUMPTION (flag for review): docs/ARCHITECTURE.md §6's frozen
// PresenterCtx shape gives a presenter `scene`, `table`, `seats`,
// `localSeat`, `assets`, `camera` and `emit()` — but no direct handle on
// the active THREE.Camera or the renderer's <canvas>, which click-to-select
// legal-move highlighting needs for raycasting. This presenter degrades
// gracefully: it searches `ctx.scene` for a camera object (`isCamera`) and
// falls back to a whole-window NDC calculation if it can't find the real
// canvas via `document.querySelector('canvas')`. If neither the app wiring
// nor the DOM cooperates, pointer input simply no-ops — the board still
// renders and every server-driven event still animates correctly, since
// legal-move highlighting is explicitly UX-only per the brief ("compute
// legal moves client-side for display only — the server is still
// authoritative"). Nothing about correctness depends on this working.

import * as THREE from 'three';
import type { PresenterCtx } from '@party/client';
import type { GameEvent } from '@party/engine';
import type { GameId } from '@party/protocol';
import * as B from './board.js';
import { CELL_SIZE, DISC_HEIGHT, TABLE_SURFACE_Y, squareToWorld } from './layout.js';
import type {
  CheckersAction,
  CheckersPieceView,
  CheckersView,
  GameOverPayload,
  PieceCapturedPayload,
  PieceCrownedPayload,
  PieceMovedPayload,
} from './module.js';

/**
 * Local restatement of docs/ARCHITECTURE.md §6's GamePresenter shape —
 * there is no shared type to import yet (every Wave 2 game defines its own,
 * per the brief).
 */
export interface GamePresenter<V = unknown> {
  gameId: GameId;
  mount(ctx: PresenterCtx): Promise<void>;
  renderView(view: V): void;
  playEvent(ev: GameEvent): Promise<void>;
  unmount(): void;
}

const TILE_HEIGHT = 0.01;
const DARK_TILE_COLOR = 0x4a3323;
const LIGHT_TILE_COLOR = 0xe8dcc8;
const LEGAL_MOVE_HIGHLIGHT_COLOR = 0x64c864;
const SELECTED_HIGHLIGHT_COLOR = 0xe0c34a;

const MOVE_DURATION_MS = 420;
const MOVE_ARC_HEIGHT = 0.18;
const CAPTURE_DURATION_MS = 380;
const CAPTURE_POP_HEIGHT = 0.35;
const CROWN_DURATION_MS = 500;

interface TrackedPiece {
  mesh: THREE.Object3D;
  owner: B.Seat;
  king: boolean;
  crownMesh: THREE.Object3D | null;
}

/** Cubic ease-in-out, t clamped to [0, 1]. */
function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Drives `onFrame(t)` from 0 to 1 over `durationMs` via requestAnimationFrame.
 * Falls back to a single synchronous `onFrame(1)` call when rAF isn't
 * available (headless/test environments) so awaiting an animation never hangs.
 */
function animate(durationMs: number, onFrame: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    if (durationMs <= 0 || typeof requestAnimationFrame !== 'function') {
      onFrame(1);
      resolve();
      return;
    }
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      onFrame(t);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

function cloneMaterials(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if ((mesh as THREE.Mesh).isMesh && mesh.material) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
    }
  });
}

function setMeshOpacity(obj: THREE.Object3D, opacity: number): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as THREE.Mesh).isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      (m as THREE.Material).transparent = true;
      (m as THREE.Material).opacity = opacity;
    }
  });
}

function buildKingMarker(owner: B.Seat): THREE.Object3D {
  const geometry = new THREE.TorusGeometry(0.14, 0.035, 8, 20);
  const material = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.35, metalness: 0.6 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = DISC_HEIGHT / 2 + 0.03;
  mesh.name = `checkers:king-marker:${owner}`;
  return mesh;
}

/** Best-effort: the first camera parented anywhere in the scene graph. See file header — PresenterCtx doesn't hand us one directly. */
function findCamera(scene: THREE.Scene): THREE.Camera | undefined {
  let found: THREE.Camera | undefined;
  scene.traverse((obj) => {
    if (!found && (obj as THREE.Camera).isCamera) found = obj as THREE.Camera;
  });
  return found;
}

function computeNdc(clientX: number, clientY: number, canvas: HTMLCanvasElement | null): THREE.Vector2 {
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    }
  }
  const w = typeof window !== 'undefined' ? window.innerWidth : 1;
  const h = typeof window !== 'undefined' ? window.innerHeight : 1;
  return new THREE.Vector2((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
}

/** Walks up from a raycast hit to the nearest ancestor tagged with a board square (tiles and pieces are both tagged — see mount()/syncPiece()). */
function squareOfObject(obj: THREE.Object3D): number | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const sq = cur.userData.square;
    if (typeof sq === 'number') return sq;
    cur = cur.parent;
  }
  return null;
}

/** CheckersPieceView and board.ts's Piece are structurally identical (id/owner/king) — this is just a readability alias, not a real conversion. */
function viewToBoard(view: CheckersView): B.Board {
  return view.board as B.Board;
}

export class CheckersPresenter implements GamePresenter<CheckersView> {
  readonly gameId: GameId = 'checkers';

  private ctx: PresenterCtx | null = null;
  private boardGroup: THREE.Group | null = null;
  private pieceGroup: THREE.Group | null = null;
  private readonly tileHighlights = new Map<number, THREE.Mesh>();
  private readonly pieces = new Map<string, TrackedPiece>();
  private readonly discTemplates = new Map<string, Promise<THREE.Object3D>>();
  private readonly pendingPieceLoads = new Set<string>();
  private latestView: CheckersView | null = null;
  private selectedSquare: number | null = null;
  private highlightedSquares: Set<number> = new Set();
  private readonly raycaster = new THREE.Raycaster();
  private pointerHandler: ((ev: PointerEvent) => void) | null = null;

  async mount(ctx: PresenterCtx): Promise<void> {
    this.ctx = ctx;

    const boardGroup = this.buildBoard();
    ctx.table.add(boardGroup);
    this.boardGroup = boardGroup;

    const pieceGroup = new THREE.Group();
    pieceGroup.name = 'checkers:pieces';
    ctx.table.add(pieceGroup);
    this.pieceGroup = pieceGroup;

    if (typeof window !== 'undefined') {
      const handler = (event: PointerEvent) => this.handlePointerDown(event);
      this.pointerHandler = handler;
      window.addEventListener('pointerdown', handler);
    }
  }

  renderView(view: CheckersView): void {
    this.latestView = view;
    if (!this.ctx) return;

    const seenIds = new Set<string>();
    for (let square = 0; square < view.board.length; square++) {
      const piece = view.board[square];
      if (!piece) continue;
      seenIds.add(piece.id);
      void this.syncPiece(piece, square);
    }

    for (const id of Array.from(this.pieces.keys())) {
      if (!seenIds.has(id)) this.removePieceImmediate(id);
    }

    // A fresh full-state render (initial mount, reconnect, or just "the
    // server moved on") invalidates any in-progress local selection.
    this.selectedSquare = null;
    this.highlightedSquares = new Set();
    this.refreshHighlights();
  }

  async playEvent(ev: GameEvent): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;

    const focusPromise = ev.focus ? ctx.camera.focus(ev.focus) : Promise.resolve();
    let animPromise: Promise<void> = Promise.resolve();

    switch (ev.type) {
      case 'piece.moved':
        animPromise = this.animateMove(ev.payload as PieceMovedPayload);
        break;
      case 'piece.captured':
        animPromise = this.animateCapture(ev.payload as PieceCapturedPayload);
        break;
      case 'piece.crowned':
        animPromise = this.animateCrown(ev.payload as PieceCrownedPayload);
        break;
      case 'game.over':
        // Nothing to animate on the board — the wide table shot is entirely
        // handled by the focus hint above. Payload kept for future HUD use.
        void (ev.payload as GameOverPayload);
        break;
      default:
        break;
    }

    await Promise.all([focusPromise, animPromise]);
  }

  unmount(): void {
    if (this.pointerHandler && typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.pointerHandler);
    }
    this.pointerHandler = null;
    this.boardGroup?.parent?.remove(this.boardGroup);
    this.pieceGroup?.parent?.remove(this.pieceGroup);
    this.boardGroup = null;
    this.pieceGroup = null;
    this.pieces.clear();
    this.tileHighlights.clear();
    this.discTemplates.clear();
    this.pendingPieceLoads.clear();
    this.latestView = null;
    this.selectedSquare = null;
    this.highlightedSquares = new Set();
    this.ctx = null;
  }

  // ---- board / piece construction -----------------------------------------

  private buildBoard(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'checkers:board';

    for (let square = 0; square < B.BOARD_SQUARES; square++) {
      const dark = B.isPlayableSquare(square);
      const world = squareToWorld(square);

      const tileGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.98, TILE_HEIGHT, CELL_SIZE * 0.98);
      const tileMaterial = new THREE.MeshStandardMaterial({
        color: dark ? DARK_TILE_COLOR : LIGHT_TILE_COLOR,
        roughness: 0.85,
      });
      const tile = new THREE.Mesh(tileGeometry, tileMaterial);
      tile.position.set(world.x, TABLE_SURFACE_Y + TILE_HEIGHT / 2, world.z);
      tile.receiveShadow = true;
      tile.userData.square = square;
      tile.name = `checkers:tile:${square}`;
      group.add(tile);

      if (dark) {
        const overlayGeometry = new THREE.PlaneGeometry(CELL_SIZE * 0.88, CELL_SIZE * 0.88);
        const overlayMaterial = new THREE.MeshBasicMaterial({
          color: LEGAL_MOVE_HIGHLIGHT_COLOR,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        });
        const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
        overlay.rotation.x = -Math.PI / 2;
        overlay.position.y = TILE_HEIGHT / 2 + 0.004;
        overlay.visible = false;
        overlay.userData.square = square;
        tile.add(overlay);
        this.tileHighlights.set(square, overlay);
      }
    }

    return group;
  }

  private async loadDiscTemplate(variant: 'light' | 'dark'): Promise<THREE.Object3D> {
    const key = `checkers/disc/${variant}`;
    let pending = this.discTemplates.get(key);
    if (!pending) {
      const ctx = this.ctx;
      if (!ctx) throw new Error('checkers presenter: not mounted');
      pending = ctx.assets.load(key) as Promise<THREE.Object3D>;
      this.discTemplates.set(key, pending);
    }
    return pending;
  }

  /** Creates (if needed) and repositions the mesh for one piece. Safe to call repeatedly — idempotent per renderView's contract. */
  private async syncPiece(piece: CheckersPieceView, square: number): Promise<void> {
    let tracked = this.pieces.get(piece.id);

    if (!tracked) {
      if (this.pendingPieceLoads.has(piece.id)) return; // a concurrent syncPiece() call is already creating it
      this.pendingPieceLoads.add(piece.id);
      try {
        const variant: 'light' | 'dark' = piece.owner === 0 ? 'dark' : 'light';
        const template = await this.loadDiscTemplate(variant);
        // Every piece needs its own mesh+material instances — the loader
        // caches and returns the SAME object for repeated calls with the
        // same key, so cloning here (materials included) is what keeps 12
        // discs of one color from becoming one disc secretly shared by all
        // of them (and keeps a later capture-fade from bleeding into every
        // other piece of that color).
        const mesh = template.clone();
        cloneMaterials(mesh);
        mesh.castShadow = true;
        mesh.name = `checkers:piece:${piece.id}`;
        this.pieceGroup?.add(mesh);
        tracked = { mesh, owner: piece.owner, king: false, crownMesh: null };
        this.pieces.set(piece.id, tracked);
      } finally {
        this.pendingPieceLoads.delete(piece.id);
      }
    }

    const world = squareToWorld(square);
    tracked.mesh.position.set(world.x, world.y, world.z);
    tracked.mesh.userData.square = square;
    this.setKingMarker(tracked, piece.king);
  }

  private setKingMarker(tracked: TrackedPiece, king: boolean): void {
    tracked.king = king;
    if (king && !tracked.crownMesh) {
      const marker = buildKingMarker(tracked.owner);
      tracked.mesh.add(marker);
      tracked.crownMesh = marker;
    } else if (!king && tracked.crownMesh) {
      tracked.mesh.remove(tracked.crownMesh);
      tracked.crownMesh = null;
    }
  }

  private removePieceImmediate(pieceId: string): void {
    const tracked = this.pieces.get(pieceId);
    if (!tracked) return;
    tracked.mesh.parent?.remove(tracked.mesh);
    this.pieces.delete(pieceId);
  }

  // ---- event animation ------------------------------------------------------

  private async animateMove(payload: PieceMovedPayload): Promise<void> {
    let tracked = this.pieces.get(payload.pieceId);
    if (!tracked) {
      // No prior renderView placed this piece (shouldn't normally happen —
      // game.view always precedes game.events per docs/ARCHITECTURE.md §3).
      // Place it directly rather than animating from nowhere.
      await this.syncPiece({ id: payload.pieceId, owner: payload.owner, king: payload.king }, payload.to);
      return;
    }

    const from = tracked.mesh.position.clone();
    const dest = squareToWorld(payload.to);
    const to = new THREE.Vector3(dest.x, dest.y, dest.z);
    const arced = tracked; // narrow for the closure below

    await animate(MOVE_DURATION_MS, (t) => {
      const eased = smoothstep(t);
      arced.mesh.position.lerpVectors(from, to, eased);
      arced.mesh.position.y = from.y + (to.y - from.y) * eased + Math.sin(Math.PI * eased) * MOVE_ARC_HEIGHT;
    });
    tracked.mesh.userData.square = payload.to;
  }

  private async animateCapture(payload: PieceCapturedPayload): Promise<void> {
    const tracked = this.pieces.get(payload.pieceId);
    if (!tracked) return;

    const startY = tracked.mesh.position.y;
    const startScale = tracked.mesh.scale.clone();

    await animate(CAPTURE_DURATION_MS, (t) => {
      const eased = smoothstep(t);
      tracked.mesh.position.y = startY + eased * CAPTURE_POP_HEIGHT;
      tracked.mesh.rotation.y += 0.3;
      const s = Math.max(0, 1 - eased);
      tracked.mesh.scale.set(startScale.x * s, startScale.y * s, startScale.z * s);
      setMeshOpacity(tracked.mesh, 1 - eased);
    });

    this.removePieceImmediate(payload.pieceId);
  }

  private async animateCrown(payload: PieceCrownedPayload): Promise<void> {
    const tracked = this.pieces.get(payload.pieceId);
    if (!tracked) return;
    this.setKingMarker(tracked, true);
    const marker = tracked.crownMesh;
    if (!marker) return;

    await animate(CROWN_DURATION_MS, (t) => {
      const eased = smoothstep(t);
      const pop = (0.2 + 0.8 * eased) * (1 + 0.3 * Math.sin(eased * Math.PI));
      marker.scale.setScalar(pop);
      marker.rotation.y = eased * Math.PI * 2;
    });
    marker.scale.setScalar(1);
  }

  // ---- input / legal-move highlighting (client-side display only) ---------

  private handlePointerDown(event: PointerEvent): void {
    const ctx = this.ctx;
    const view = this.latestView;
    if (!ctx || !view || !this.boardGroup || !this.pieceGroup) return;

    const camera = findCamera(ctx.scene);
    if (!camera) return; // see file header — no camera reachable, no-op

    const canvas = typeof document !== 'undefined' ? document.querySelector('canvas') : null;
    const ndc = computeNdc(event.clientX, event.clientY, canvas);
    this.raycaster.setFromCamera(ndc, camera);

    const hits = this.raycaster.intersectObjects([this.boardGroup, this.pieceGroup], true);
    const square = hits.length > 0 ? squareOfObject(hits[0]!.object) : null;
    if (square === null) {
      this.clearSelection();
      return;
    }

    this.handleSquareClick(view, ctx, square);
  }

  private handleSquareClick(view: CheckersView, ctx: PresenterCtx, square: number): void {
    if (this.selectedSquare !== null && this.highlightedSquares.has(square)) {
      const action: CheckersAction = { type: 'move', from: this.selectedSquare, to: square };
      ctx.emit(action);
      this.clearSelection();
      return;
    }

    const piece = view.board[square];
    const localOwner = ctx.localSeat as B.Seat;
    if (!piece || piece.owner !== localOwner) {
      this.clearSelection();
      return;
    }

    const board = viewToBoard(view);
    let moves = B.legalMovesFrom(board, square);
    if (view.activeChain !== null) {
      moves = square === view.activeChain ? moves.filter((m) => m.kind === 'capture') : [];
    } else if (view.forcedCapture && B.ownerHasAnyCapture(board, localOwner)) {
      moves = moves.filter((m) => m.kind === 'capture');
    }

    this.selectedSquare = square;
    this.highlightedSquares = new Set(moves.map((m) => m.to));
    this.refreshHighlights();
  }

  private clearSelection(): void {
    this.selectedSquare = null;
    this.highlightedSquares = new Set();
    this.refreshHighlights();
  }

  private refreshHighlights(): void {
    for (const [square, overlay] of this.tileHighlights) {
      if (square === this.selectedSquare) {
        overlay.visible = true;
        (overlay.material as THREE.MeshBasicMaterial).color.setHex(SELECTED_HIGHLIGHT_COLOR);
      } else if (this.highlightedSquares.has(square)) {
        overlay.visible = true;
        (overlay.material as THREE.MeshBasicMaterial).color.setHex(LEGAL_MOVE_HIGHLIGHT_COLOR);
      } else {
        overlay.visible = false;
      }
    }
  }
}
