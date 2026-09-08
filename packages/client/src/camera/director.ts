import type { FocusHint } from '@party/engine';

export interface CameraPose {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/**
 * The seam between the camera director (A6) and the table/presenter layer
 * (A5, and later every game presenter in Wave 2). A6 implements a real class
 * satisfying this; A5 only needs the type to assemble PresenterCtx.camera.
 *
 * Frozen for Wave 1 by the overseer for the same reason as Transport
 * (packages/server/src/net/transport.ts) — enables true parallel build.
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
