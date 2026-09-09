// Owned by A5 (Wave 1). Pure geometry: N seats evenly distributed around
// the table for N in [2,8]. No renderer/DOM dependency — see scene.ts's
// header comment for why that split matters for headless testing.

import { TABLE_SURFACE_Y } from './scene.js';
import { createAvatarPlaceholder, AVATAR_FOOTPRINT_RADIUS, AVATAR_TOTAL_HEIGHT } from './avatar.js';
import type { SeatLayout } from './types.js';
import type { CameraPose } from '../camera/director.js';

export const MIN_SEATS = 2;
export const MAX_SEATS = 8;

/** Distance from table centre to each seat's standing position. */
export const SEAT_RING_RADIUS = 2.1;
/**
 * First-person home pose (P3 rework — was a third-person "over-the-shoulder"
 * pose pulled back by a CAMERA_BEHIND_OFFSET and raised above head height;
 * that blocked the board with the local player's own avatar). The camera
 * now sits exactly at the seat's standing position — nowhere else — at
 * roughly eye height, matching where this seat's own eyes would be. Fraction
 * of AVATAR_TOTAL_HEIGHT a standing person's eyes sit at (~93% of full
 * height is a standard anthropometric ratio).
 */
const EYE_HEIGHT_RATIO = 0.93;
const EYE_HEIGHT = AVATAR_TOTAL_HEIGHT * EYE_HEIGHT_RATIO;
/** Eye-line height used for the look-at target, above the table surface. */
const LOOK_AT_HEIGHT = TABLE_SURFACE_Y + 0.35;

export interface SeatLayoutOptions {
  /** Nameplate label per seat, e.g. usernames once the lobby is wired (A4). Defaults to "Seat N". */
  labels?: string[];
}

/**
 * N seats evenly spaced on a ring around the table origin, each facing
 * table centre. Seat 0 is placed at the "south" side (positive Z, facing
 * -Z toward the origin) so a lone local player faces the table naturally;
 * remaining seats proceed counter-clockwise from there.
 *
 * `localSeat` only affects avatar tinting (see avatar.ts) — the ring
 * geometry itself is identical regardless of which seat is local; the
 * camera is pointed home via PresenterCtx assembly (presenter-ctx.ts), not
 * by reordering seats.
 */
export function computeSeatLayout(seatCount: number, localSeat: number, options: SeatLayoutOptions = {}): SeatLayout[] {
  if (!Number.isInteger(seatCount) || seatCount < MIN_SEATS || seatCount > MAX_SEATS) {
    throw new RangeError(`seatCount must be an integer in [${MIN_SEATS}, ${MAX_SEATS}], got ${seatCount}`);
  }
  if (!Number.isInteger(localSeat) || localSeat < 0 || localSeat >= seatCount) {
    throw new RangeError(`localSeat must be an integer in [0, ${seatCount - 1}], got ${localSeat}`);
  }

  const seats: SeatLayout[] = [];
  for (let seat = 0; seat < seatCount; seat++) {
    // seat 0 at angle 0 => (0, 0, +radius); proceed counter-clockwise.
    const angle = (seat / seatCount) * Math.PI * 2;
    const x = Math.sin(angle) * SEAT_RING_RADIUS;
    const z = Math.cos(angle) * SEAT_RING_RADIUS;
    // Facing the origin: yaw such that the avatar's local -Z (its forward
    // axis, matching Three.js/camera convention) points from (x,z) to (0,0).
    const rotationY = Math.atan2(x, z) + Math.PI;

    const label = options.labels?.[seat] ?? `Seat ${seat + 1}`;
    const isLocal = seat === localSeat;

    const avatar = createAvatarPlaceholder(label, isLocal);
    avatar.position.set(x, 0, z);
    avatar.rotation.y = rotationY;

    const cameraPose = computeHomeCameraPose(x, z);

    seats.push({
      seat,
      position: { x, y: 0, z },
      rotationY,
      avatar,
      cameraPose,
    });
  }
  return seats;
}

/**
 * The seat's own eye-view: camera sits AT the seat's standing position (no
 * behind/outward offset — that was the third-person pull-back) at eye
 * height, looking toward the table the way the seated player actually would.
 */
function computeHomeCameraPose(seatX: number, seatZ: number): CameraPose {
  return {
    position: { x: seatX, y: EYE_HEIGHT, z: seatZ },
    target: { x: 0, y: LOOK_AT_HEIGHT, z: 0 },
  };
}

/** Straight-line distance between two seats' standing positions. */
export function seatDistance(a: SeatLayout, b: SeatLayout): number {
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  return Math.hypot(dx, dz);
}

/** Minimum standing-position gap that counts as "no overlap" for the avatar's footprint. */
export const MIN_NON_OVERLAP_DISTANCE = AVATAR_FOOTPRINT_RADIUS * 2;
