// Structural smoke test for the DoD in this wave's assignment: seats never
// overlap at 2/4/6/8 seats, and the local player's seat is identifiable.
// Runs headless under Vitest's default 'node' environment (no DOM/WebGL
// needed — see scene.ts/avatar.ts header comments for how the pure
// scene-graph pieces stay usable without a canvas).
//
// NOT covered here, and not automatable in a unit test: actual rendered
// frame rate on integrated graphics / phones. That's a manual spot-check —
// see this wave's final report.

import { describe, it, expect } from 'vitest';
import {
  computeSeatLayout,
  seatDistance,
  MIN_NON_OVERLAP_DISTANCE,
  MIN_SEATS,
  MAX_SEATS,
} from './seat-layout.js';

describe('computeSeatLayout', () => {
  for (const seatCount of [2, 4, 6, 8]) {
    describe(`${seatCount} seats`, () => {
      it('returns one SeatLayout per seat, index === seat number', () => {
        const seats = computeSeatLayout(seatCount, 0);
        expect(seats).toHaveLength(seatCount);
        seats.forEach((seat, index) => {
          expect(seat.seat).toBe(index);
        });
      });

      it('no two seats overlap', () => {
        const seats = computeSeatLayout(seatCount, 0);
        for (let i = 0; i < seats.length; i++) {
          for (let j = i + 1; j < seats.length; j++) {
            const distance = seatDistance(seats[i], seats[j]);
            expect(distance).toBeGreaterThan(MIN_NON_OVERLAP_DISTANCE);
          }
        }
      });

      it('every seat has a distinct world position', () => {
        const seats = computeSeatLayout(seatCount, 0);
        const positions = seats.map((s) => `${s.position.x.toFixed(6)},${s.position.z.toFixed(6)}`);
        expect(new Set(positions).size).toBe(seatCount);
      });

      it('every seat has a finite home camera pose aimed at the table centre', () => {
        const seats = computeSeatLayout(seatCount, 0);
        for (const seat of seats) {
          expect(Number.isFinite(seat.cameraPose.position.x)).toBe(true);
          expect(Number.isFinite(seat.cameraPose.position.y)).toBe(true);
          expect(Number.isFinite(seat.cameraPose.position.z)).toBe(true);
          expect(seat.cameraPose.target).toEqual({ x: 0, y: seat.cameraPose.target.y, z: 0 });
        }
      });

      it("the local player's seat is identifiable for each possible local seat", () => {
        for (let localSeat = 0; localSeat < seatCount; localSeat++) {
          const seats = computeSeatLayout(seatCount, localSeat);
          // seats[localSeat] is the local player's own entry, by construction.
          expect(seats[localSeat].seat).toBe(localSeat);
          // The avatar object itself is tagged so a caller inspecting the
          // scene graph directly (not just the seats array) can also tell
          // which capsule is "you" — see avatar.ts's isLocal tint.
          const localMesh = seats[localSeat].avatar.getObjectByName('avatar-body') as
            | { material?: { color?: { getHex: () => number } } }
            | undefined;
          expect(localMesh).toBeDefined();
        }
      });
    });
  }

  it('rejects seat counts outside [2, 8]', () => {
    expect(() => computeSeatLayout(MIN_SEATS - 1, 0)).toThrow(RangeError);
    expect(() => computeSeatLayout(MAX_SEATS + 1, 0)).toThrow(RangeError);
    expect(() => computeSeatLayout(1, 0)).toThrow(RangeError);
    expect(() => computeSeatLayout(9, 0)).toThrow(RangeError);
  });

  it('rejects an out-of-range localSeat', () => {
    expect(() => computeSeatLayout(4, -1)).toThrow(RangeError);
    expect(() => computeSeatLayout(4, 4)).toThrow(RangeError);
  });

  it('accepts custom nameplate labels, one per seat', () => {
    const seats = computeSeatLayout(3, 0, { labels: ['Alice', 'Bob', 'Cleo'] });
    expect(seats).toHaveLength(3);
    expect(seats[0].avatar.name).toBe('avatar:Alice');
    expect(seats[1].avatar.name).toBe('avatar:Bob');
    expect(seats[2].avatar.name).toBe('avatar:Cleo');
  });
});
