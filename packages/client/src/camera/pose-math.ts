// Pure pose/vector math for the CameraDirector. Deliberately free of any
// THREE.js dependency so it's trivial to unit test without a scene/renderer.

import type { CameraPose } from './director.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Cubic ease-in-out. `t` is clamped to [0, 1] first. */
export function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  return { position: lerpVec3(a.position, b.position, t), target: lerpVec3(a.target, b.target, t) };
}

export function approxEqualVec3(a: Vec3, b: Vec3, epsilon = 1e-3): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.z - b.z) < epsilon;
}

export function approxEqualPose(a: CameraPose, b: CameraPose, epsilon = 1e-3): boolean {
  return approxEqualVec3(a.position, b.position, epsilon) && approxEqualVec3(a.target, b.target, epsilon);
}

export interface PoseClampOptions {
  /** The camera position may never sit lower than this world-Y. */
  minHeight: number;
  /** The camera must stay at least this far above whatever it's looking at, so the view can never invert past the horizon. */
  minAboveTarget: number;
  /** Cylindrical exclusion zone radius (world units, XZ plane, centered on the origin) representing the table. */
  tableRadius: number;
  /** World-Y of the table surface. */
  tableSurfaceY: number;
  /** Minimum clearance the camera keeps above the table surface while inside `tableRadius`. */
  tableClearance: number;
}

/**
 * Keeps a resolved camera *position* from ever passing through the table or
 * flipping upside-down past the horizon. Never applied to `target` — a
 * look-at point is allowed to sit on/under the table surface (that's what
 * makes it a believable look-at point).
 */
export function clampCameraPosition(position: Vec3, target: Vec3, opts: PoseClampOptions): Vec3 {
  let y = position.y;
  y = Math.max(y, opts.minHeight);
  y = Math.max(y, target.y + opts.minAboveTarget);
  const horizontalDistFromCenter = Math.hypot(position.x, position.z);
  if (horizontalDistFromCenter < opts.tableRadius) {
    y = Math.max(y, opts.tableSurfaceY + opts.tableClearance);
  }
  return { x: position.x, y, z: position.z };
}
