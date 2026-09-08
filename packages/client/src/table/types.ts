// Owned by A5 (Wave 1). See docs/ARCHITECTURE.md §6 "The presenter contract"
// for the frozen shape of PresenterCtx — SeatLayout itself isn't specified
// there beyond "world transforms, index === seat number", so its concrete
// fields are A5's call.

import type * as THREE from 'three';
import type { CameraPose } from '../camera/director.js';

/** One seat around the table. `seats[i].seat === i` always holds. */
export interface SeatLayout {
  /** 0..n-1 — this seat's index, and its position in the owning SeatLayout[]. */
  seat: number;
  /** World-space position of the seat (where the avatar stands). */
  position: { x: number; y: number; z: number };
  /** Yaw, radians, facing the table centre. */
  rotationY: number;
  /**
   * Placeholder body (capsule + nameplate) for this seat, already positioned
   * and rotated at the seat's world transform. Real per-player models are
   * A7's later work — see PresenterCtx.assets.
   */
  avatar: THREE.Object3D;
  /** Over-the-shoulder home camera pose for this seat, looking at table centre. */
  cameraPose: CameraPose;
}
