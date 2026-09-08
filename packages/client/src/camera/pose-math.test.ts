import { describe, it, expect } from 'vitest';
import { clampCameraPosition, lerpPose, smoothstep, approxEqualPose } from './pose-math.js';

const CLAMP_OPTS = { minHeight: 0.6, minAboveTarget: 0.35, tableRadius: 1.6, tableSurfaceY: 0.75, tableClearance: 0.5 };

describe('smoothstep', () => {
  it('clamps to [0, 1] and is monotonic', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 5);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(2)).toBe(1);
  });
});

describe('lerpPose', () => {
  it('interpolates position and target independently', () => {
    const a = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
    const b = { position: { x: 10, y: 10, z: 10 }, target: { x: 4, y: 4, z: 4 } };
    const mid = lerpPose(a, b, 0.5);
    expect(mid.position).toEqual({ x: 5, y: 5, z: 5 });
    expect(mid.target).toEqual({ x: 2, y: 2, z: 2 });
    expect(approxEqualPose(lerpPose(a, b, 0), a)).toBe(true);
    expect(approxEqualPose(lerpPose(a, b, 1), b)).toBe(true);
  });
});

describe('clampCameraPosition', () => {
  it('never lets the camera dip below the global minimum height', () => {
    const p = clampCameraPosition({ x: 5, y: -3, z: 5 }, { x: 5, y: -3, z: 5 }, CLAMP_OPTS);
    expect(p.y).toBeGreaterThanOrEqual(CLAMP_OPTS.minHeight);
  });

  it('never lets the camera invert below/at the target it is looking at', () => {
    const p = clampCameraPosition({ x: 5, y: 1, z: 5 }, { x: 5, y: 1, z: 5 }, CLAMP_OPTS);
    expect(p.y).toBeGreaterThanOrEqual(1 + CLAMP_OPTS.minAboveTarget);
  });

  it('never lets the camera pass through the table when directly over it', () => {
    const p = clampCameraPosition({ x: 0, y: 0.2, z: 0 }, { x: 0, y: 0.75, z: 0 }, CLAMP_OPTS);
    expect(p.y).toBeGreaterThanOrEqual(CLAMP_OPTS.tableSurfaceY + CLAMP_OPTS.tableClearance);
  });

  it('leaves a position that is already safely above the table unchanged', () => {
    const p = clampCameraPosition({ x: 0, y: 4, z: 3 }, { x: 0, y: 0.75, z: 0 }, CLAMP_OPTS);
    expect(p).toEqual({ x: 0, y: 4, z: 3 });
  });

  it('does not apply the table clamp outside the table radius', () => {
    const p = clampCameraPosition({ x: 10, y: 0.65, z: 10 }, { x: 10, y: 0.5, z: 10 }, CLAMP_OPTS);
    // Far from the table center, so no table-surface clamp — only the
    // global minHeight / minAboveTarget floors apply.
    expect(p.y).toBeGreaterThanOrEqual(CLAMP_OPTS.minHeight);
    expect(p.y).toBeLessThan(CLAMP_OPTS.tableSurfaceY + CLAMP_OPTS.tableClearance);
  });
});
