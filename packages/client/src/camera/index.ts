// Owned by A6 (Wave 1).
//
// The CameraDirector — consumes FocusHint (@party/engine, via
// @party/protocol) emitted on GameEvents, moves the camera to follow the
// action, and returns to the local player's seat afterward. Knows nothing
// about any specific game — see docs/ARCHITECTURE.md "The GameEvent
// stream" for why this decoupling matters.

export type { CameraDirector, CameraPose } from './director.js';
export { ThreeCameraDirector } from './CameraDirector.js';
export type {
  CameraDirectorOptions,
  ObjectResolver,
  // Renamed on export (not in the source file) to avoid colliding with
  // table/index.ts's SeatLayout at the package barrel (packages/client/src/index.ts
  // does `export * from './table/index.js'` and `export * from './camera/index.js'`).
  // This is camera's own minimal structural type (see types.ts) — table's real
  // SeatLayout is a structural superset and satisfies it at every call site, so
  // renaming the export doesn't require touching any camera internals.
  SeatLayout as CameraSeatLayout,
  SeatSource,
  TableBoundsOptions,
} from './types.js';
export type { Vec3 } from './pose-math.js';
