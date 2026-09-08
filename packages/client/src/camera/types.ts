import type * as THREE from 'three';
import type { CameraPose } from './director.js';
import type { Vec3 } from './pose-math.js';

/**
 * The world position of a seat, indexed by seat number. This is a narrower
 * local shape than whatever `packages/client/src/table` (A5) eventually
 * defines as the canonical seat-layout type — ARCHITECTURE.md §1 describes
 * it as "world transforms, index === seat number", which this is a subset
 * of. A6 doesn't own the table/scene package and needs to resolve `{ kind:
 * 'seat' }` focus targets without waiting for A5's real implementation to
 * land, so this module defines and consumes its own minimal shape. If A5's
 * real SeatLayout is a structural superset (has at least `position`), no
 * changes should be needed on either side — flagged in the PR as an
 * assumption regardless.
 */
export interface SeatLayout {
  position: Vec3;
}

/** Either a pre-built array (index === seat number) or a lookup callback — the brief allows either. */
export type SeatSource = SeatLayout[] | ((seat: number) => SeatLayout | undefined);

/**
 * Resolves a scene object id (FocusTarget kind 'object') to a world
 * position. The director doesn't own the scene graph, so it never touches a
 * THREE.Object3D directly — the caller (A5's table / a game presenter)
 * supplies this lookup. Returning `undefined` for an unknown id causes the
 * focus hint to be dropped (logged, promise resolved) rather than throwing.
 */
export type ObjectResolver = (id: string) => Vec3 | undefined;

export interface TableBoundsOptions {
  /** Horizontal radius (world units) of the table's collision/exclusion zone. Default 1.6 — a generous board/card table. */
  radius?: number;
  /** World-Y of the table surface. Default 0.75 — a typical table height. */
  surfaceY?: number;
  /**
   * Camera pose for the 'table' wide establishing shot. A5's real table
   * dimensions aren't merged into this wave, so the default is a hardcoded,
   * reasonable-looking framing centered on the origin — see the PR
   * description for this assumption.
   */
  establishingShot?: CameraPose;
}

export interface CameraDirectorOptions {
  /** The camera this director drives. Owned by the caller (A5) — this class never constructs or replaces it. */
  camera: THREE.PerspectiveCamera;
  /** Initial home pose (see `setHome`). Defaults to a generic behind-the-seat framing if omitted; callers should call `setHome` once the real seat pose is known. */
  home?: CameraPose;
  /** Seat lookup for `{ kind: 'seat' }` focus targets. */
  seats?: SeatSource;
  /** Scene-object lookup for `{ kind: 'object' }` focus targets. */
  resolveObject?: ObjectResolver;
  table?: TableBoundsOptions;
  /** Maximum queued focus requests before low-priority coalescing kicks in. Default 4. */
  maxQueueLength?: number;
  /** Ease duration (ms) for a camera move, when not in reduced-motion mode. Default 550. */
  easeMs?: number;
  /** Default dwell time (ms) when a FocusHint omits `holdMs`. Default 1200. */
  defaultHoldMs?: number;
  /** Hard floor for `holdMs`, hint or default. Default 300. */
  minHoldMs?: number;
  /** Hard ceiling for `holdMs`, hint or default. Default 4000. */
  maxHoldMs?: number;
  /**
   * Force reduced-motion behavior on/off regardless of `matchMedia`. Mainly
   * for tests; in production, omit this and let `matchMedia` decide.
   */
  reducedMotion?: boolean;
  /** Injectable `matchMedia`, for environments/tests without `window.matchMedia`. Defaults to `globalThis.matchMedia` when present. */
  matchMedia?: (query: string) => { matches: boolean } | undefined | null;
}
