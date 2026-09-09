// Overseer-extracted leaf package (added after Wave 2), not originally in
// the plan's package layout.
//
// Why this exists: packages/client/src/table/presenter-ctx.ts (A5) and
// packages/client/src/camera/director.ts (A6) originally defined
// PresenterCtx/CameraDirector/SeatLayout locally in @party/client, and each
// of Wave 2's three game packages (checkers/holdem/codewords) depended on
// @party/client to implement against those types in their own presenter.ts.
// When the overseer wired the client app to dynamically import each game's
// presenter (packages/client/src/app/game-presenters.ts), @party/client
// started depending on the game packages too — creating a circular
// TypeScript project reference (client -> games/* -> client), which `tsc -b`
// refuses to build.
//
// This package breaks the cycle: it holds ONLY the type contracts every
// presenter (client-side table/camera AND every game's presenter.ts) needs,
// with no dependency on @party/client. @party/client now re-exports these
// types (for source compatibility with Wave 1/2 code that imported them
// from '@party/client') and *implements* them (ThreeCameraDirector,
// createPresenterCtx, computeSeatLayout); every game package now depends on
// @party/presenter instead of @party/client.

import type * as THREE from 'three';
import type { GameId, GameEvent, FocusHint } from '@party/protocol';
import type { AssetLoader } from '@party/assets';

export interface CameraPose {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/**
 * The seam between the camera director (built by @party/client's
 * ThreeCameraDirector) and everything that drives it (table setup, and
 * every game presenter via PresenterCtx.camera).
 */
export interface CameraDirector {
  /** Ease toward the hinted target, dwell holdMs, then ease back home. Requests queue; 'high' priority preempts. */
  focus(hint: FocusHint): Promise<void>;
  /** Ease back to the local player's seat pose. */
  home(): Promise<void>;
  /** Sets the pose 'home' eases back to — typically the local player's seat, from SeatLayout. */
  setHome(pose: CameraPose): void;
  /** Immediate cut, no easing — used for prefers-reduced-motion and first mount. */
  snap(): void;
}

/** One seat around the table. `seats[i].seat === i` always holds. */
export interface SeatLayout {
  /** 0..n-1 — this seat's index, and its position in the owning SeatLayout[]. */
  seat: number;
  /** World-space position of the seat (where the avatar stands). */
  position: { x: number; y: number; z: number };
  /** Yaw, radians, facing the table centre. */
  rotationY: number;
  /** Low-poly primitive humanoid body + nameplate for this seat, positioned/rotated at the seat's world transform. */
  avatar: THREE.Object3D;
  /** Over-the-shoulder home camera pose for this seat, looking at table centre. */
  cameraPose: CameraPose;
}

/**
 * Frozen shape, per docs/ARCHITECTURE.md §6 "the presenter contract".
 * Built by @party/client's createPresenterCtx; consumed by every game's
 * presenter.ts.
 */
export interface PresenterCtx {
  scene: THREE.Scene;
  table: THREE.Object3D;
  /** World transforms, index === seat number. */
  seats: SeatLayout[];
  localSeat: number;
  assets: AssetLoader;
  camera: CameraDirector;
  /** User intent -> server. */
  emit(action: unknown): void;
}

/**
 * What every packages/games/*\/presenter.ts implements. Each of Wave 2's
 * three games independently defined a structurally-identical copy of this
 * (there was nowhere shared to import it from yet) — this is now the one
 * canonical definition; game packages built after this point should import
 * it from here instead of redeclaring it.
 */
export interface GamePresenter<V = unknown> {
  gameId: GameId;
  mount(ctx: PresenterCtx): Promise<void>;
  renderView(view: V): void;
  playEvent(ev: GameEvent): Promise<void>;
  unmount(): void;
}

/**
 * Table geometry constants. Canonical home moved here (from @party/client's
 * table/scene.ts, which now imports them from here instead of defining its
 * own) so a game presenter can know where the playing surface is without
 * depending on @party/client. Values must stay in sync with the actual
 * table mesh built in @party/client's createTable() — there is exactly one
 * source of truth (here) to keep that true by construction, not convention.
 */
export const TABLE_RADIUS = 1.3;
export const TABLE_HEIGHT = 0.08;
/** World-space Y of the table's playing surface — pieces sit at/above this. */
export const TABLE_SURFACE_Y = TABLE_HEIGHT;

export { el, clear, type ElAttrs, type ElChild } from './dom.js';
