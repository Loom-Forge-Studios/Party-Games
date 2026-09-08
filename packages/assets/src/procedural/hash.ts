/**
 * Deterministic (non-Math.random) pseudo-noise for procedural textures.
 *
 * This isn't game state — it never touches `reduce()` or anything that
 * affects a game outcome — but the repo-wide "no Math.random() in anything
 * that matters" habit is cheap to keep here too: a wood-grain or felt
 * texture built from a hash is reproducible run to run (nice for tests and
 * for not surprising anyone with flicker), where Math.random() would not
 * be.
 */

/** Cheap 2D integer hash -> [0, 1). Deterministic for a given (x, y, seed). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2654435761) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  // Force unsigned, then normalize to [0, 1).
  return (h >>> 0) / 4294967296;
}
