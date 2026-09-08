// Owned by A5 (Wave 1). Real WebGLRenderer bootstrap + a dirty-flag render
// loop that idles when nothing is animating, plus resize handling with a
// capped device pixel ratio. This needs a real <canvas> and GL context, so
// unlike scene.ts/seat-layout.ts it cannot be exercised by an automated
// unit test in this repo's Node-environment Vitest setup (see
// vitest.config.ts) — it's built to spec but only spot-checkable manually
// in an actual browser. Flagged explicitly in this wave's final report as
// the one piece that needs a manual look, per the DoD note about
// 60fps-on-integrated-graphics not being automatable.

import * as THREE from 'three';

/** Never render at more than this pixel ratio — this must run acceptably on modest/integrated GPUs and phones, where an uncapped devicePixelRatio (3x on many phones) is wasted fill-rate. */
export const MAX_PIXEL_RATIO = 2;

export interface RenderLoopHandle {
  /** Marks the scene dirty; renders exactly once on the next animation frame, then goes idle again until requested again. Call this after any state change that should appear on screen (camera move, event animation tick, resize). */
  requestRender: () => void;
  /** Resizes the renderer's drawing buffer and CSS size, updates the camera's aspect ratio, and requests a render. */
  setSize: (width: number, height: number, camera: THREE.PerspectiveCamera) => void;
  /** Stops the loop and releases the pending animation-frame callback, if any. */
  dispose: () => void;
}

/** Builds a WebGLRenderer with shadows on and pixel ratio capped for modest hardware. */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

/**
 * A render loop that idles when nothing is animating: it only calls
 * `renderer.render` on a frame where something marked the scene dirty via
 * `requestRender()`, and stops scheduling `requestAnimationFrame` callbacks
 * entirely once it has caught up — it does not spin an empty rAF loop.
 * This is the piece that keeps a static table (no game event playing, no
 * camera easing in flight) from burning battery/GPU on a phone.
 */
export function createRenderLoop(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): RenderLoopHandle {
  let dirty = true; // paint once on mount
  let rafHandle: number | null = null;

  function frame(): void {
    rafHandle = null;
    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
  }

  function requestRender(): void {
    dirty = true;
    if (rafHandle === null) {
      rafHandle = requestAnimationFrame(frame);
    }
  }

  function setSize(width: number, height: number, cam: THREE.PerspectiveCamera): void {
    renderer.setSize(width, height);
    cam.aspect = height === 0 ? 1 : width / height;
    cam.updateProjectionMatrix();
    requestRender();
  }

  function dispose(): void {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  return { requestRender, setSize, dispose };
}

/**
 * Wires `window` resize + the container's ResizeObserver into the render
 * loop, so the canvas tracks its container's size without the caller
 * hand-rolling listeners. Returns a cleanup function.
 */
export function attachResizeHandling(
  container: HTMLElement,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  loop: RenderLoopHandle,
): () => void {
  const resize = () => {
    const { clientWidth, clientHeight } = container;
    loop.setSize(clientWidth, clientHeight, camera);
  };

  resize();

  let observer: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(resize);
    observer.observe(container);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', resize);
  }

  return () => {
    if (observer) {
      observer.disconnect();
    } else if (typeof window !== 'undefined') {
      window.removeEventListener('resize', resize);
    }
  };
}

/** A perspective camera with reasonable defaults for an over-the-shoulder table view. */
export function createDefaultCamera(aspect = 1): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 50);
  return camera;
}
