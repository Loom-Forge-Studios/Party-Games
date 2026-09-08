import * as THREE from 'three';
import { hash2 } from './hash.js';

/**
 * Canvas availability varies by environment: real in a browser (where this
 * package actually runs), absent under plain Node (where our own unit
 * tests run, via Vitest's `environment: 'node'`). Every texture builder in
 * this directory goes through here so that "no canvas" degrades to a
 * flat-shaded `DataTexture` instead of throwing — same "never crash, always
 * hand back something renderable" contract as `AssetLoader.load` itself.
 */
export function canvasAvailable(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

export type RGB = readonly [number, number, number];

/**
 * Draws with a 2D canvas context when one is available; otherwise falls
 * back to a solid-colour `DataTexture` built from typed arrays (no DOM
 * required). Both paths return a texture ready to assign to a material's
 * `map`.
 */
export function buildDrawnTexture(
  size: number,
  fallbackColor: RGB,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.Texture {
  if (canvasAvailable()) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      draw(ctx, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    }
  }
  return buildSolidDataTexture(size, fallbackColor);
}

/** A flat single-colour texture, built without any canvas/DOM dependency. */
export function buildSolidDataTexture(size: number, [r, g, b]: RGB): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A recognisable magenta/black checkerboard, the conventional "missing
 * asset" marker — built purely from typed arrays so it works identically
 * whether or not a canvas is available. Used for the fallback primitive
 * `AssetLoader` hands back for any key it doesn't recognise.
 */
export function buildCheckerboardTexture(size = 64, tiles = 8): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const tileSize = Math.max(1, Math.floor(size / tiles));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const isMagenta = (Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2 === 0;
      if (isMagenta) {
        data[i] = 255;
        data[i + 1] = 0;
        data[i + 2] = 255;
      } else {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Deterministic speckled-noise texture (wood grain, felt nap) built from
 * `hash2` rather than `Math.random()` — see hash.ts for why. Works with or
 * without a canvas.
 */
export function buildNoiseTexture(
  size: number,
  base: RGB,
  variance: RGB,
  seed: number,
  streak: 'horizontal' | 'none' = 'none',
): THREE.Texture {
  if (canvasAvailable()) {
    return buildDrawnTexture(size, base, (ctx, s) => {
      const image = ctx.createImageData(s, s);
      fillNoise(image.data, s, base, variance, seed, streak);
      ctx.putImageData(image, 0, 0);
    });
  }
  const data = new Uint8Array(size * size * 4);
  fillNoise(data, size, base, variance, seed, streak);
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function fillNoise(
  data: Uint8ClampedArray | Uint8Array,
  size: number,
  base: RGB,
  variance: RGB,
  seed: number,
  streak: 'horizontal' | 'none',
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Wood grain reads as long horizontal streaks: sample noise mostly
      // along y so a run of pixels across x shares a value.
      const nx = streak === 'horizontal' ? Math.floor(x / 3) : x;
      const n = hash2(nx, y, seed) * 2 - 1; // [-1, 1)
      data[i] = clampByte(base[0] + n * variance[0]);
      data[i + 1] = clampByte(base[1] + n * variance[1]);
      data[i + 2] = clampByte(base[2] + n * variance[2]);
      data[i + 3] = 255;
    }
  }
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
