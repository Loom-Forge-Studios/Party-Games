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
  SeatLayout,
  SeatSource,
  TableBoundsOptions,
} from './types.js';
export type { Vec3 } from './pose-math.js';
