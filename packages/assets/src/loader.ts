/**
 * The seam between the assets pipeline (A7) and everything that mounts
 * geometry into the scene (A5 table, and later every game presenter in
 * Wave 2). Deliberately untyped as THREE.Object3D here — this package must
 * stay usable without forcing a hard three.js version coupling on every
 * consumer's type layer — callers narrow the return value themselves.
 * A7 implements a real class satisfying this, with graceful fallback to
 * primitives when a named asset is missing.
 *
 * Frozen for Wave 1 by the overseer for the same reason as Transport
 * (packages/server/src/net/transport.ts) — enables true parallel build.
 */
export interface AssetLoader {
  /** Resolves to a THREE.Object3D (typed unknown here — see file doc). Never rejects: falls back to a placeholder primitive and logs a warning instead. */
  load(key: string): Promise<unknown>;
}
