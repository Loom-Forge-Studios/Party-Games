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

import type * as THREE from 'three';
import type { AssetLoader } from '@party/assets';
import type { CameraDirector } from '../camera/director.js';
import type { SeatLayout } from './types.js';
import { createScene } from './scene.js';
import { computeSeatLayout, type SeatLayoutOptions } from './seat-layout.js';
import { PlaceholderAssetLoader } from './placeholder-asset-loader.js';

/**
 * Frozen shape, reproduced from docs/ARCHITECTURE.md §6. Defined here (not
 * imported from anywhere) because packages/client/src/table/ is where the
 * doc says it lands once A5 formalizes it.
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
