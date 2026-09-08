import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { FocusHint } from '@party/engine';
import { ThreeCameraDirector } from './CameraDirector.js';
import type { CameraPose } from './director.js';

const HOME: CameraPose = { position: { x: 0, y: 3, z: 5 }, target: { x: 0, y: 0.75, z: 0 } };

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
}

function makeDirector(overrides: Partial<ConstructorParameters<typeof ThreeCameraDirector>[0]> = {}) {
  return new ThreeCameraDirector({
    camera: makeCamera(),
    home: HOME,
    seats: [{ position: { x: -2, y: 0.75, z: 0 } }, { position: { x: 2, y: 0.75, z: 0 } }],
    // Keep tests deterministic and independent of a browser matchMedia.
    reducedMotion: false,
    ...overrides,
  });
}

function pointHint(x: number, priority?: FocusHint['priority'], holdMs?: number): FocusHint {
  return { target: { kind: 'point', x, y: 0.75, z: 0 }, priority, holdMs };
}

function queuedX(hints: FocusHint[]): (number | undefined)[] {
  return hints.map((h) => (h.target.kind === 'point' ? h.target.x : undefined));
}

/** Advances the director in small fixed steps so easing has a chance to be observed mid-flight. */
function advance(director: ThreeCameraDirector, totalMs: number, stepMs = 16) {
  let remaining = totalMs;
  while (remaining > 0) {
    const step = Math.min(stepMs, remaining);
    director.update(step);
    remaining -= step;
  }
}

describe('ThreeCameraDirector', () => {
  let director: ThreeCameraDirector;

  beforeEach(() => {
    director = makeDirector();
  });

  it('starts idle at home', () => {
    expect(director.isIdleAtHome()).toBe(true);
    expect(director.getPose()).toEqual(HOME);
  });

  it('snap() cuts instantly to home with no easing', () => {
    void director.focus(pointHint(1));
    director.update(50); // partway through easing to the target
    expect(director.isIdleAtHome()).toBe(false);

    director.snap();

    expect(director.getPhase()).toBe('idle');
    expect(director.getPose()).toEqual(HOME);
    expect(director.getQueueLength()).toBe(0);
  });

  it('always returns home after N focus requests with no further input', async () => {
    const results: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(director.focus(pointHint(i)));
    }
    // Drive well past every ease + dwell + final ease-home.
    advance(director, 60_000);
    await Promise.all(results);

    expect(director.getPhase()).toBe('idle');
    expect(director.isIdleAtHome()).toBe(true);
    expect(director.getQueueLength()).toBe(0);
  });

  it('processes queued requests in order (FIFO for equal priority)', async () => {
    const seen: number[] = [];
    const d = new ThreeCameraDirector({
      camera: makeCamera(),
      home: HOME,
      reducedMotion: true,
      minHoldMs: 0,
      defaultHoldMs: 10,
    });

    const p1 = d.focus(pointHint(1, 'normal', 10));
    const p2 = d.focus(pointHint(2, 'normal', 10));
    const p3 = d.focus(pointHint(3, 'normal', 10));

    // First request starts immediately (queue was empty) -> dwelling at x=1.
    seen.push(d.getPose().target.x);
    expect(d.getPhase()).toBe('dwell');

    advance(d, 10); // finish dwell #1 -> starts #2 immediately (instant ease under reduced motion)
    seen.push(d.getPose().target.x);

    advance(d, 10); // finish dwell #2 -> starts #3
    seen.push(d.getPose().target.x);

    advance(d, 10); // finish dwell #3 -> home (instant)
    await Promise.all([p1, p2, p3]);

    expect(seen).toEqual([1, 2, 3]);
    expect(d.isIdleAtHome()).toBe(true);
  });

  it('a high-priority request preempts whatever is currently playing', async () => {
    const d = new ThreeCameraDirector({
      camera: makeCamera(),
      home: HOME,
      easeMs: 200,
      defaultHoldMs: 5000,
      maxHoldMs: 20_000,
    });

    const low = d.focus(pointHint(1, 'low'));
    advance(d, 250); // finish easing to target, now deep into a long dwell
    expect(d.getPhase()).toBe('dwell');
    expect(d.getQueueLength()).toBe(0);

    const second = d.focus(pointHint(2, 'normal'));
    // still just queued behind the long dwell, not preempting it
    expect(d.getQueueLength()).toBe(1);

    const urgent = d.focus(pointHint(9, 'high'));
    // high priority clears the queue and cuts the current dwell short
    expect(d.getQueueLength()).toBe(0);
    expect(d.getPhase()).toBe('toTarget');

    advance(d, 60_000);
    await Promise.all([low, second, urgent]);

    expect(d.isIdleAtHome()).toBe(true);
  });

  it('coalesces a burst of low-priority requests: the queue never exceeds the cap and stale low-priority hints get dropped', async () => {
    const cap = 4;
    const d = new ThreeCameraDirector({
      camera: makeCamera(),
      home: HOME,
      maxQueueLength: cap,
      easeMs: 1,
      defaultHoldMs: 1,
      minHoldMs: 0,
      maxHoldMs: 1,
    });

    // The first focus request starts playing immediately (queue was idle),
    // so it never occupies a queue slot. Fire enough more to blow past the
    // cap many times over, as a burst arriving faster than the camera can
    // possibly react.
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(d.focus(pointHint(i, 'low')));
      expect(d.getQueueLength()).toBeLessThanOrEqual(cap);
    }
    expect(d.getQueueLength()).toBeLessThanOrEqual(cap);

    advance(d, 10_000);
    await Promise.all(promises);

    expect(d.getQueueLength()).toBeLessThanOrEqual(cap);
    expect(d.isIdleAtHome()).toBe(true);
  });

  it('does not evict a normal-priority request to make room for an incoming low-priority one once the queue is full', () => {
    const cap = 2;
    const d = new ThreeCameraDirector({
      camera: makeCamera(),
      home: HOME,
      maxQueueLength: cap,
      easeMs: 10_000,
      defaultHoldMs: 10_000,
    });

    void d.focus(pointHint(0, 'normal')); // starts immediately, never queued
    void d.focus(pointHint(1, 'normal')); // queued[0]
    void d.focus(pointHint(2, 'normal')); // queued[1] -> queue full (cap=2)
    expect(d.getQueueLength()).toBe(2);

    // Queue is full, has no 'low' entries to evict, and the incoming hint
    // is itself 'low' -> it must be dropped outright, not admitted by
    // displacing a normal-priority request.
    void d.focus(pointHint(3, 'low'));
    expect(d.getQueueLength()).toBe(2);
    expect(queuedX(d.getQueuedFocusHints())).toEqual([1, 2]);
  });

  it('evicts the oldest stale low-priority request to make room once the queue is full', () => {
    const cap = 2;
    const d = new ThreeCameraDirector({
      camera: makeCamera(),
      home: HOME,
      maxQueueLength: cap,
      easeMs: 10_000,
      defaultHoldMs: 10_000,
    });

    void d.focus(pointHint(0, 'normal')); // starts immediately, never queued
    void d.focus(pointHint(1, 'low')); // queued[0] — stale by the time the queue fills
    void d.focus(pointHint(2, 'normal')); // queued[1] -> queue full (cap=2)
    expect(d.getQueueLength()).toBe(2);

    void d.focus(pointHint(3, 'normal')); // queue full — evicts the stale low-priority hint (x=1)
    expect(d.getQueueLength()).toBe(2);
    expect(queuedX(d.getQueuedFocusHints())).toEqual([2, 3]);
  });

  it('resolves seat targets from the seats array and clamps the camera above the table', () => {
    const d = new ThreeCameraDirector({
      camera: makeCamera(),
      home: HOME,
      reducedMotion: true,
      seats: [{ position: { x: -2, y: 0.75, z: 0 } }],
    });

    void d.focus({ target: { kind: 'seat', seat: 0 }, holdMs: 10 });
    const pose = d.getPose();
    expect(pose.target).toEqual({ x: -2, y: 0.75, z: 0 });
    expect(pose.position.y).toBeGreaterThan(0.75);
  });

  it('drops a focus hint for an unknown seat rather than throwing, and resolves its promise', async () => {
    const d = new ThreeCameraDirector({ camera: makeCamera(), home: HOME, seats: [] });

    await expect(d.focus({ target: { kind: 'seat', seat: 7 } })).resolves.toBeUndefined();
    expect(d.isIdleAtHome()).toBe(true);
  });

  it('resolves object targets via the injected lookup and drops unknown ids', async () => {
    const d = new ThreeCameraDirector({
      camera: makeCamera(),
      home: HOME,
      reducedMotion: true,
      minHoldMs: 0,
      defaultHoldMs: 5,
      resolveObject: (id) => (id === 'die-1' ? { x: 1.5, y: 0.9, z: -0.5 } : undefined),
    });

    void d.focus({ target: { kind: 'object', id: 'die-1' }, holdMs: 5 });
    expect(d.getPose().target).toEqual({ x: 1.5, y: 0.9, z: -0.5 });

    advance(d, 10); // let the dwell (and the instant ease-home under reduced motion) finish
    expect(d.isIdleAtHome()).toBe(true);

    await expect(d.focus({ target: { kind: 'object', id: 'missing' } })).resolves.toBeUndefined();
    expect(d.isIdleAtHome()).toBe(true);
  });

  it('uses a hardcoded wide establishing shot for a table-kind focus', () => {
    const d = new ThreeCameraDirector({ camera: makeCamera(), home: HOME, reducedMotion: true });

    void d.focus({ target: { kind: 'table' }, holdMs: 10 });
    const pose = d.getPose();
    expect(pose.position.y).toBeGreaterThan(HOME.position.y);
  });

  it('respects prefers-reduced-motion by cutting instantly instead of easing', () => {
    const d = new ThreeCameraDirector({
      camera: makeCamera(),
      home: HOME,
      matchMedia: () => ({ matches: true }),
      defaultHoldMs: 50,
    });

    void d.focus(pointHint(3));
    // No update() ticks at all — reduced motion means the pose is applied
    // synchronously as the phase starts, not eased over frames.
    expect(d.getPose().target.x).toBe(3);
    expect(d.getPhase()).toBe('dwell');
  });

  it('setHome updates the pose future home cycles ease back to', async () => {
    const p = director.focus(pointHint(4));
    advance(director, 60_000);
    await p;
    expect(director.isIdleAtHome()).toBe(true);

    const newHome: CameraPose = { position: { x: 1, y: 3, z: 6 }, target: { x: 1, y: 0.75, z: 0 } };
    director.setHome(newHome);
    expect(director.getHomePose()).toEqual(newHome);

    const p2 = director.focus(pointHint(5));
    advance(director, 60_000);
    await p2;
    expect(director.getPose()).toEqual(newHome);
  });

  it('home() abandons the queue and current target, returning to home pose', async () => {
    void director.focus(pointHint(1, 'normal', 5000));
    advance(director, 700); // now deep in a long dwell
    void director.focus(pointHint(2));
    void director.focus(pointHint(3));
    expect(director.getQueueLength()).toBe(2);

    const homeDone = director.home();
    advance(director, 60_000);
    await homeDone;

    expect(director.getQueueLength()).toBe(0);
    expect(director.isIdleAtHome()).toBe(true);
  });

  it('never lets the camera position pass below/through the table for a point near table level', () => {
    const d = new ThreeCameraDirector({ camera: makeCamera(), home: HOME, reducedMotion: true });

    void d.focus({ target: { kind: 'point', x: 0, y: 0.1, z: 0 }, holdMs: 10 });
    expect(d.getPose().position.y).toBeGreaterThan(0.75);
  });
});
