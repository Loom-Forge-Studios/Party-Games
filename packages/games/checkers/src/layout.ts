// Pure world-coordinate math shared between module.ts (for FocusHint 'point'
// targets — see docs/ARCHITECTURE.md §6/§7: rule modules must not import
// Three.js or @party/client) and presenter.ts (for actually placing meshes).
// Keeping this in one Three-free file means the two never disagree about
// where square N is on the table.
//
// Seat geometry (packages/client/src/table/seat-layout.ts, frozen/A5): for
// 2 seats, seat 0 sits at (0, 0, +SEAT_RING_RADIUS) facing -Z, seat 1 sits
// at (0, 0, -SEAT_RING_RADIUS) facing +Z. board.ts starts seat 0's pieces on
// rows 5-7 and seat 1's on rows 0-2, so mapping row -> +Z as row increases
// puts each side's starting pieces on their own physical side of the table.

import { BOARD_DIM } from './board.js';

/** Centre-to-centre spacing between adjacent squares, in world units. */
export const CELL_SIZE = 0.18;

/**
 * World-space Y of the table's playing surface. Must match
 * packages/client/src/table/scene.ts's TABLE_SURFACE_Y (owned by A5,
 * frozen) — duplicated here as a literal because this file must stay
 * Three.js/@party-client-free. presenter.ts double-checks this against the
 * real export at mount time (see its header comment).
 */
export const TABLE_SURFACE_Y = 0.08;

/** Matches checkers/disc/{light,dark}'s DISC_HEIGHT in packages/assets/src/procedural/checkers.ts, so a disc's centre rests flush on the table surface. */
export const DISC_HEIGHT = 0.025;

/** World-space Y a disc's centre rests at. */
export const PIECE_REST_Y = TABLE_SURFACE_Y + DISC_HEIGHT / 2;

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

const BOARD_CENTER_OFFSET = (BOARD_DIM - 1) / 2;

/** The world-space point a piece resting on `square` occupies. */
export function squareToWorld(square: number): WorldPoint {
  const row = Math.floor(square / BOARD_DIM);
  const col = square % BOARD_DIM;
  return {
    x: (col - BOARD_CENTER_OFFSET) * CELL_SIZE,
    y: PIECE_REST_Y,
    z: (row - BOARD_CENTER_OFFSET) * CELL_SIZE,
  };
}

/** Half the board's total footprint on one axis — useful for sizing the board mesh/tiles in the presenter. */
export const BOARD_HALF_EXTENT = (BOARD_DIM * CELL_SIZE) / 2;
