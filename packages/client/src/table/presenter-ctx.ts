// Owned by A5 (Wave 1). Assembles PresenterCtx — see
// docs/ARCHITECTURE.md §6 "The presenter contract" for the frozen shape.
// This is the thing Wave 2 game presenters mount into.
//
// `assets` and `camera` are accepted as constructor parameters rather than
// constructed here, per this wave's assignment: A7's real AssetLoader and
// A6's real CameraDirector aren't available yet (parallel worktrees). This
// factory defaults `assets` to a local PlaceholderAssetLoader so callers
// (including this package's own tests, and Wave 2 once it starts) aren't
// blocked; `camera` has no safe default (it drives the actual view) and
// must always be supplied by the caller.
//
// PresenterCtx's canonical definition now lives in @party/presenter (moved
// there by the overseer after Wave 2 to break a circular dependency between
// @party/client and the game packages — see that package's src/index.ts).
// Re-exported below for source compatibility.

import type { AssetLoader } from '@party/assets';
import type { CameraDirector, PresenterCtx } from '@party/presenter';
import { createScene } from './scene.js';
import { computeSeatLayout, type SeatLayoutOptions } from './seat-layout.js';
import { PlaceholderAssetLoader } from './placeholder-asset-loader.js';

export type { PresenterCtx } from '@party/presenter';

export interface CreatePresenterCtxOptions {
  seatCount: number;
  localSeat: number;
  /** A6's real CameraDirector once merged; a test fake until then — see this package's tests for an example fake. */
  camera: CameraDirector;
  /** Defaults to PlaceholderAssetLoader — swap in A7's real AssetLoader once merged. */
  assets?: AssetLoader;
  /** Forwards a validated user intent to the server (wired by A4's app bootstrap in a later wave). Defaults to a no-op so this ctx is usable standalone in tests. */
  emit?: (action: unknown) => void;
  /** Optional seat nameplate labels (e.g. usernames, once the lobby is wired). */
  labels?: string[];
}

/**
 * Builds a complete PresenterCtx: a fresh scene with table + lighting +
 * seat avatars, seat camera poses computed, and the local seat's pose
 * pushed to the injected CameraDirector as "home".
 */
export function createPresenterCtx(options: CreatePresenterCtxOptions): PresenterCtx {
  const { scene, table } = createScene();

  const seatOptions: SeatLayoutOptions = options.labels ? { labels: options.labels } : {};
  const seats = computeSeatLayout(options.seatCount, options.localSeat, seatOptions);
  for (const seat of seats) {
    scene.add(seat.avatar);
  }

  const assets = options.assets ?? new PlaceholderAssetLoader();
  const emit = options.emit ?? (() => {});

  options.camera.setHome(seats[options.localSeat].cameraPose);
  // setHome() only records the pose 'home' eases back to later — see
  // @party/presenter's CameraDirector doc comment, "snap(): ... used for
  // ... first mount". Without this, a freshly-constructed CameraDirector
  // sits at its own generic DEFAULT_HOME (ThreeCameraDirector.ts) — a
  // wide establishing view, not this seat's actual eye-level pose — until
  // some later focus/home cycle happens to move it. Snap immediately so
  // the very first frame already shows this seat's real first-person view.
  options.camera.snap();

  return {
    scene,
    table,
    seats,
    localSeat: options.localSeat,
    assets,
    camera: options.camera,
    emit,
  };
}
