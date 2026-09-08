import type * as THREE from 'three';
import type { FocusHint } from '@party/engine';
import type { CameraDirector as ICameraDirector, CameraPose } from './director.js';
import type { CameraDirectorOptions, ObjectResolver, SeatLayout, SeatSource } from './types.js';
import { approxEqualPose, clampCameraPosition, lerpPose, smoothstep, type Vec3 } from './pose-math.js';

type Priority = 'low' | 'normal' | 'high';
type Phase = 'idle' | 'toTarget' | 'dwell' | 'toHome';

interface QueueItem {
  hint: FocusHint;
  resolve: () => void;
}

const DEFAULT_HOME: CameraPose = { position: { x: 0, y: 3.6, z: 5.4 }, target: { x: 0, y: 0.75, z: 0 } };
const DEFAULT_ESTABLISHING_SHOT: CameraPose = { position: { x: 0, y: 6.2, z: 7.4 }, target: { x: 0, y: 0.4, z: 0 } };
const POINT_OFFSET: Vec3 = { x: 0, y: 2.6, z: 3.4 };
const SEAT_OFFSET: Vec3 = { x: 0, y: 2.2, z: 2.8 };

/**
 * Real `CameraDirector` implementation. Drives a `THREE.PerspectiveCamera`
 * handed to it (it doesn't own the scene or a table package — see
 * docs/ARCHITECTURE.md and packages/client/src/camera/director.ts) through
 * the state machine described in the A6 brief:
 *
 *   idle at home -> focus request -> ease to target -> dwell holdMs -> ease home
 *
 * Focus requests queue (capped, with stale low-priority coalescing under a
 * burst); a 'high' priority request preempts whatever is currently playing.
 * When the queue drains, the next cycle's "ease home" step is skipped in
 * favor of easing straight to the next queued target — the machine only
 * actually returns home once nothing is left to show, which is what keeps a
 * fast sequence of game events from yo-yoing the camera home and back for
 * every single one. See the PR description for this as a deliberate reading
 * of the brief's literal per-request state machine.
 */
export class ThreeCameraDirector implements ICameraDirector {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly seats?: SeatSource;
  private readonly resolveObjectFn?: ObjectResolver;
  private readonly maxQueueLength: number;
  private readonly easeMsOption: number;
  private readonly defaultHoldMs: number;
  private readonly minHoldMs: number;
  private readonly maxHoldMs: number;
  private readonly reducedMotionOverride?: boolean;
  private readonly matchMediaFn?: (query: string) => { matches: boolean } | undefined | null;
  private readonly tableShot: CameraPose;
  private readonly clampOpts: {
    minHeight: number;
    minAboveTarget: number;
    tableRadius: number;
    tableSurfaceY: number;
    tableClearance: number;
  };

  private homePose: CameraPose;
  private currentPose: CameraPose;
  private phase: Phase = 'idle';
  private phaseElapsed = 0;
  private phaseDurationMs = 0;
  private fromPose: CameraPose;
  private toPose: CameraPose;
  private active: QueueItem | null = null;
  private queue: QueueItem[] = [];
  private homeWaiters: Array<() => void> = [];
  private rafHandle: number | null = null;
  private lastTickTime: number | null = null;

  constructor(options: CameraDirectorOptions) {
    this.camera = options.camera;
    this.seats = options.seats;
    this.resolveObjectFn = options.resolveObject;
    this.maxQueueLength = Math.max(1, options.maxQueueLength ?? 4);
    this.easeMsOption = options.easeMs ?? 550;
    this.defaultHoldMs = options.defaultHoldMs ?? 1200;
    this.minHoldMs = options.minHoldMs ?? 300;
    this.maxHoldMs = options.maxHoldMs ?? 4000;
    this.reducedMotionOverride = options.reducedMotion;
    this.matchMediaFn =
      options.matchMedia ??
      (typeof globalThis !== 'undefined' && typeof globalThis.matchMedia === 'function'
        ? globalThis.matchMedia.bind(globalThis)
        : undefined);

    const tableRadius = options.table?.radius ?? 1.6;
    const tableSurfaceY = options.table?.surfaceY ?? 0.75;
    this.clampOpts = {
      minHeight: 0.6,
      minAboveTarget: 0.35,
      tableRadius,
      tableSurfaceY,
      tableClearance: 0.5,
    };
    this.tableShot = options.table?.establishingShot ?? DEFAULT_ESTABLISHING_SHOT;

    this.homePose = options.home ? this.clampPose(options.home) : DEFAULT_HOME;
    this.currentPose = this.homePose;
    this.fromPose = this.homePose;
    this.toPose = this.homePose;
    this.applyPose(this.homePose);

    this.maybeStartLoop();
  }

  // ---- CameraDirector interface -------------------------------------------------

  focus(hint: FocusHint): Promise<void> {
    return new Promise<void>((resolve) => {
      const item: QueueItem = { hint, resolve };
      const priority = this.priorityOf(hint);
      if (priority === 'high') {
        this.preempt(item);
      } else {
        this.enqueue(item);
      }
    });
  }

  home(): Promise<void> {
    return new Promise<void>((resolve) => {
      for (const q of this.queue) q.resolve();
      this.queue = [];
      if (this.active) {
        this.active.resolve();
        this.active = null;
      }
      this.goHome();
      if (this.phase === 'idle') {
        resolve();
      } else {
        this.homeWaiters.push(resolve);
      }
    });
  }

  setHome(pose: CameraPose): void {
    this.homePose = this.clampPose(pose);
  }

  snap(): void {
    for (const q of this.queue) q.resolve();
    this.queue = [];
    if (this.active) {
      this.active.resolve();
      this.active = null;
    }
    this.phase = 'idle';
    this.phaseElapsed = 0;
    this.phaseDurationMs = 0;
    this.applyPose(this.homePose);
    this.flushHomeWaiters();
  }

  // ---- extra, non-interface surface for tests / lifecycle -----------------------

  /** Advances the state machine by `dtMs` milliseconds. Call this directly in tests; in a browser it's driven automatically via requestAnimationFrame. */
  update(dtMs: number): void {
    let remaining = Math.max(0, dtMs);
    let guard = 0;
    while (this.phase !== 'idle' && guard < 64) {
      guard++;
      const durLeft = this.phaseDurationMs - this.phaseElapsed;
      if (remaining < durLeft) {
        this.phaseElapsed += remaining;
        if (this.phase === 'toTarget' || this.phase === 'toHome') this.applyEasedPose();
        return;
      }
      remaining -= durLeft;
      this.phaseElapsed = this.phaseDurationMs;
      if (this.phase === 'toTarget' || this.phase === 'toHome') this.applyPose(this.toPose);
      this.onPhaseComplete();
    }
  }

  /** Stops the internal requestAnimationFrame loop, if one was started. Call on teardown. */
  dispose(): void {
    if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = null;
  }

  getPhase(): Phase {
    return this.phase;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getPose(): CameraPose {
    return this.currentPose;
  }

  getHomePose(): CameraPose {
    return this.homePose;
  }

  /** The FocusHints currently queued (not counting whichever one is actively playing). Exposed for tests. */
  getQueuedFocusHints(): FocusHint[] {
    return this.queue.map((q) => q.hint);
  }

  isIdleAtHome(): boolean {
    return this.phase === 'idle' && this.poseIsAtHome();
  }

  // ---- queue / state machine internals -------------------------------------------

  private priorityOf(hint: FocusHint): Priority {
    return hint.priority ?? 'normal';
  }

  private preempt(item: QueueItem): void {
    for (const q of this.queue) q.resolve();
    this.queue = [];
    if (this.active) {
      this.active.resolve();
      this.active = null;
    }
    this.startItem(item);
  }

  private enqueue(item: QueueItem): void {
    const priority = this.priorityOf(item.hint);
    if (this.queue.length >= this.maxQueueLength) {
      const staleLowIdx = this.queue.findIndex((q) => this.priorityOf(q.hint) === 'low');
      if (staleLowIdx !== -1) {
        const [dropped] = this.queue.splice(staleLowIdx, 1);
        dropped.resolve();
      } else if (priority === 'low') {
        // Queue is full of normal/high work and this new hint is low
        // priority — drop it outright rather than displacing something
        // more important.
        item.resolve();
        return;
      } else {
        const dropped = this.queue.shift();
        dropped?.resolve();
      }
    }
    this.queue.push(item);
    if (this.phase === 'idle' && !this.active) {
      this.advanceQueue();
    }
  }

  /** Pulls the next item off the queue and starts it, skipping unresolvable hints. Falls back to going home when the queue is empty. */
  private advanceQueue(): void {
    const next = this.queue.shift();
    if (!next) {
      this.goHome();
      return;
    }
    this.startItem(next);
  }

  private startItem(item: QueueItem): void {
    const resolved = this.resolveHint(item.hint);
    if (!resolved) {
      item.resolve();
      this.advanceQueue();
      return;
    }
    this.active = item;
    this.beginPhase('toTarget', resolved, this.easeDuration());
  }

  private poseIsAtHome(): boolean {
    return approxEqualPose(this.currentPose, this.homePose);
  }

  private goHome(): void {
    if (this.phase === 'idle' && this.poseIsAtHome()) return;
    this.beginPhase('toHome', this.homePose, this.easeDuration());
  }

  /**
   * Starts easing toward `toPose`. When `durationMs` is 0 (reduced motion),
   * the pose is applied immediately and the phase is drained synchronously
   * into whatever comes next (dwell, or straight through to idle) — reduced
   * motion means "cut instantly", not "wait one frame to cut instantly".
   * Real dwell time still elapses via `update()`; only the easing itself is
   * ever skippable this way.
   */
  private beginPhase(phase: 'toTarget' | 'toHome', toPose: CameraPose, durationMs: number): void {
    this.phase = phase;
    this.phaseElapsed = 0;
    this.phaseDurationMs = Math.max(0, durationMs);
    this.fromPose = this.currentPose;
    this.toPose = toPose;
    if (this.phaseDurationMs === 0) {
      this.applyPose(toPose);
      this.onPhaseComplete();
    }
  }

  private beginDwell(durationMs: number): void {
    this.phase = 'dwell';
    this.phaseElapsed = 0;
    this.phaseDurationMs = Math.max(0, durationMs);
    if (this.phaseDurationMs === 0) {
      this.onPhaseComplete();
    }
  }

  private onPhaseComplete(): void {
    if (this.phase === 'toTarget') {
      const holdMs = this.clampHold(this.active?.hint.holdMs);
      this.beginDwell(holdMs);
      return;
    }
    if (this.phase === 'dwell') {
      if (this.active) {
        this.active.resolve();
        this.active = null;
      }
      if (this.queue.length > 0) {
        this.advanceQueue();
      } else {
        this.goHome();
      }
      return;
    }
    if (this.phase === 'toHome') {
      if (this.queue.length > 0) {
        this.advanceQueue();
        return;
      }
      this.phase = 'idle';
      this.phaseElapsed = 0;
      this.phaseDurationMs = 0;
      this.flushHomeWaiters();
      return;
    }
  }

  private flushHomeWaiters(): void {
    const waiters = this.homeWaiters;
    this.homeWaiters = [];
    for (const w of waiters) w();
  }

  private clampHold(ms: number | undefined): number {
    const v = ms ?? this.defaultHoldMs;
    return Math.min(this.maxHoldMs, Math.max(this.minHoldMs, v));
  }

  private easeDuration(): number {
    return this.reducedMotionActive() ? 0 : this.easeMsOption;
  }

  private reducedMotionActive(): boolean {
    if (this.reducedMotionOverride !== undefined) return this.reducedMotionOverride;
    if (!this.matchMediaFn) return false;
    try {
      return !!this.matchMediaFn('(prefers-reduced-motion: reduce)')?.matches;
    } catch {
      return false;
    }
  }

  // ---- pose application / easing -------------------------------------------------

  private applyEasedPose(): void {
    const t = this.phaseDurationMs === 0 ? 1 : smoothstep(this.phaseElapsed / this.phaseDurationMs);
    this.applyPose(lerpPose(this.fromPose, this.toPose, t));
  }

  private applyPose(pose: CameraPose): void {
    this.currentPose = pose;
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  }

  private clampPose(pose: CameraPose): CameraPose {
    return { position: clampCameraPosition(pose.position, pose.target, this.clampOpts), target: pose.target };
  }

  // ---- FocusTarget resolution -----------------------------------------------------

  private resolveHint(hint: FocusHint): CameraPose | undefined {
    const target = hint.target;
    switch (target.kind) {
      case 'point':
        return this.frameLookAtPoint({ x: target.x, y: target.y, z: target.z }, POINT_OFFSET);
      case 'object': {
        const point = this.resolveObjectFn?.(target.id);
        if (!point) {
          console.warn(`[CameraDirector] unknown scene object id "${target.id}" — dropping focus hint`);
          return undefined;
        }
        return this.frameLookAtPoint(point, POINT_OFFSET);
      }
      case 'seat': {
        const seat = this.lookupSeat(target.seat);
        if (!seat) {
          console.warn(`[CameraDirector] unknown seat ${target.seat} — dropping focus hint`);
          return undefined;
        }
        return this.frameLookAtPoint(seat.position, SEAT_OFFSET);
      }
      case 'table':
        return this.tableShot;
      default:
        return undefined;
    }
  }

  private lookupSeat(seat: number): SeatLayout | undefined {
    if (!this.seats) return undefined;
    return typeof this.seats === 'function' ? this.seats(seat) : this.seats[seat];
  }

  private frameLookAtPoint(point: Vec3, offset: Vec3): CameraPose {
    const rawPosition = { x: point.x + offset.x, y: point.y + offset.y, z: point.z + offset.z };
    const position = clampCameraPosition(rawPosition, point, this.clampOpts);
    return { position, target: point };
  }

  // ---- optional auto-drive loop (browser only; tests call update() directly) ----

  private maybeStartLoop(): void {
    if (this.rafHandle !== null) return;
    if (typeof requestAnimationFrame !== 'function') return;
    const tick = (now: number) => {
      const last = this.lastTickTime ?? now;
      this.update(now - last);
      this.lastTickTime = now;
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }
}
