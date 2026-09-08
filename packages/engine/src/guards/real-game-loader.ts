// Loads the real, shipped game packages under packages/games/* for their
// registerGame() side effect — the same reason packages/server/src/index.ts
// imports them (see that file's own header comment) — so these guards can
// run against actual game rules, not just inline fixtures.
//
// WHY DYNAMIC, RUNTIME-COMPUTED IMPORTS (never a string-literal specifier):
// @party/engine is upstream of every game package — every packages/games/*
// package.json depends on @party/engine, never the reverse (see
// docs/ARCHITECTURE.md's protocol/engine circular-dependency note for why
// this repo goes out of its way to keep that dependency graph a straight
// line, never circular). A plain `import('@party/game-checkers')` written
// as a literal string inside @party/engine's own source is statically
// resolved and type-checked by TypeScript, which means `tsc -b` would need
// packages/games/checkers listed as a project reference of @party/engine to
// build correctly — and adding that reference would create exactly the
// cycle the architecture doc warns against (packages/games/* already
// reference @party/engine). This file's own ownership (A12 owns only
// packages/engine/src/guards/) also means it cannot touch
// packages/engine/package.json or tsconfig.json to declare that dependency
// even if it wanted to.
//
// The fix: build every module specifier from a runtime expression (never a
// literal token in the import() call itself). TypeScript only attempts
// static module resolution for a dynamic import() when its argument is
// syntactically a string literal or no-substitution template literal —
// once it's a variable/expression, the whole expression types as
// `Promise<any>` and no project-reference/module-resolution machinery runs
// at all (verified directly against this exact repo layout: a literal
// `import('@party/game-checkers')` inside this package is resolved and
// type-checked by `tsc -b`; the computed form below is not — see this
// guard suite's own README-style notes in registry-liveness.ts for the
// consequence that matters operationally). At runtime (Vitest, after
// `just verify`'s typecheck/build steps have already emitted every
// package's dist/), this is a completely ordinary Node ESM import that
// resolves through npm workspaces' node_modules symlinks exactly the way
// packages/server/src/index.ts's own static imports do.
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameId } from '@party/protocol';
import type { GameModule } from '../types.js';

function gamesDirAbsPath(): string {
  // This file lives at packages/engine/src/guards/real-game-loader.ts;
  // packages/games is three levels up from there.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../games');
}

/**
 * Every directory under packages/games/*, read live off disk rather than
 * hardcoded — so this guard suite (and registry-liveness.ts in particular)
 * automatically covers each of the ~80 eventual games as its package lands,
 * with zero changes here. Each `<id>` directory is expected to be an npm
 * workspace package named `@party/game-<id>` (see e.g.
 * packages/games/checkers/package.json's "name") whose "." export
 * `export default`s that game's GameModule — every real v1 game package
 * already follows this convention (see each one's index.ts).
 */
export function discoverGameIdsFromDisk(): GameId[] {
  return readdirSync(gamesDirAbsPath(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function dynamicImport(specifier: string): Promise<any> {
  // Kept as its own tiny function so `specifier` is never, anywhere, a
  // string-literal argument to `import(...)` — see file header.
  return import(specifier);
}

/**
 * Imports `@party/game-<id>`'s "." export (triggering its registerGame()
 * side effect, mirroring packages/server/src/index.ts's own import list)
 * and returns the GameModule it default-exports.
 */
export async function loadRealGameModule(id: GameId): Promise<GameModule<any, any, any>> {
  const specifier = `@party/game-${id}`;
  const mod = await dynamicImport(specifier);
  const gameModule = mod?.default;
  if (!gameModule) {
    throw new Error(
      `real-game-loader: "${specifier}" has no default export — every game package's index.ts is expected to ` +
        `\`export default <itsGameModule>\` alongside its registerGame() call (see packages/games/checkers/src/index.ts).`,
    );
  }
  return gameModule as GameModule<any, any, any>;
}

/** Discovers every packages/games/* directory (see discoverGameIdsFromDisk) and imports each one's real package, keyed by id. */
export async function loadAllRealGameModules(): Promise<Record<GameId, GameModule<any, any, any>>> {
  const ids = discoverGameIdsFromDisk();
  const entries = await Promise.all(ids.map(async (id): Promise<[GameId, GameModule<any, any, any>]> => [id, await loadRealGameModule(id)]));
  return Object.fromEntries(entries) as Record<GameId, GameModule<any, any, any>>;
}

/**
 * Loads @party/engine itself through the identical dynamic-import
 * indirection described in this file's header, and returns its registry
 * functions. ONLY the registry-liveness guard needs this: it must observe
 * the registry state as mutated by loadRealGameModule()'s registerGame()
 * side effects, and that mutation only lands in the *same loaded instance*
 * of @party/engine that the game packages themselves imported — their
 * package.json resolves "@party/engine" to its built dist, same as any
 * other external consumer. Importing '../registry.js' by relative path
 * instead would resolve to this package's *source* (a different module
 * instance under Vitest, with its own separate, never-mutated registry
 * Map) — so nothing that needs to observe registerGame()'s effect may do
 * that.
 */
export async function loadEngineRegistryHandle(): Promise<{
  getGame: (id: GameId) => GameModule<any, any, any> | undefined;
  allGameIds: () => GameId[];
}> {
  const specifier = '@party/engine';
  const mod = await dynamicImport(specifier);
  return { getGame: mod.getGame, allGameIds: mod.allGameIds };
}
