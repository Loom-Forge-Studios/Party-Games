// Registry liveness guard — the automated check for docs/ARCHITECTURE.md
// §7's "a game that is built but not registered/reachable from the lobby
// is not done", which is exactly the bug the overseer found and fixed
// after Wave 2 (a game fully implemented and registered into @party/engine,
// but never imported anywhere the running server actually loads — see
// packages/server/src/index.ts's own header comment on this). This guard
// makes that regress loudly instead of silently:
//
// 1. Every directory under packages/games/* (discovered live off disk —
//    see real-game-loader.ts's discoverGameIdsFromDisk) has a real,
//    non-stub entry in @party/engine's registry once its package is
//    imported — i.e. registry.getGame(id).meta.summary must not still read
//    like the Wave-1 stub's "<title> — rules not implemented yet."
//    placeholder (see packages/engine/src/registry.ts's stubModule()).
// 2. packages/server/src/index.ts — read-only to this package, see that
//    file's own header — must actually `import` every one of those
//    packages for its registerGame() side effect. A game can be fully
//    built and registered yet never reachable from the server if nothing
//    ever imports it; this assertion means that specific regression can
//    never land silently again, for any of the ~80 eventual games.
//
// The two checks above are exported as small, pure, independently-testable
// functions (assertRegistryEntryIsReal / assertServerImportsEveryGame) —
// see registry-liveness.test.ts's positive controls, which feed each one a
// deliberately-broken fixture input rather than actually breaking the real
// (read-only) files this package doesn't own.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverGameIdsFromDisk, loadAllRealGameModules, loadEngineRegistryHandle } from './real-game-loader.js';

const STUB_SUMMARY_MARKER = 'not implemented yet';

export class RegistryLivenessError extends Error {}

function serverIndexSourcePath(): string {
  // This file lives at packages/engine/src/guards/registry-liveness.ts;
  // packages/server/src/index.ts is four levels up from there.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../server/src/index.ts');
}

/** Throws unless `meta.summary` has been overwritten from the Wave-1 stub's placeholder text (see packages/engine/src/registry.ts's stubModule()). */
export function assertRegistryEntryIsReal(id: string, meta: { summary: string }): void {
  if (meta.summary.includes(STUB_SUMMARY_MARKER)) {
    throw new RegistryLivenessError(
      `registry-liveness: registry.getGame("${id}").meta.summary still reads like the Wave-1 stub ("${meta.summary}") — ` +
        `either "${id}"'s real package never called registerGame("${id}", ...), or something re-registered the stub over it afterwards.`,
    );
  }
}

/** Throws unless `serverSource` imports `@party/game-<id>` for every id given — the exact string packages/server/src/index.ts's own real imports contain. */
export function assertServerImportsEveryGame(serverSource: string, ids: readonly string[]): void {
  for (const id of ids) {
    const pkg = `@party/game-${id}`;
    if (!serverSource.includes(pkg)) {
      throw new RegistryLivenessError(
        `registry-liveness: packages/server/src/index.ts does not import "${pkg}" — a game can be fully built and registered in ` +
          `@party/engine's registry yet never reachable from the running server if nothing imports it for that side effect ` +
          `(see that file's own header comment on this exact regression). packages/server is read-only to this package, so if this ` +
          `fires, something removed a needed import there.`,
      );
    }
  }
}

export interface RegistryLivenessResult {
  checkedIds: string[];
}

/**
 * Imports every packages/games/* package (for its registerGame() side
 * effect) and asserts the registry + the real packages/server/src/index.ts
 * both actually reflect it. Throws RegistryLivenessError with a specific,
 * actionable message on the first violation found.
 */
export async function assertRegistryReflectsRealGames(): Promise<RegistryLivenessResult> {
  const ids = discoverGameIdsFromDisk();
  if (ids.length === 0) {
    throw new RegistryLivenessError('registry-liveness: packages/games/* has no subdirectories — nothing to check (is packages/games/ empty?)');
  }

  await loadAllRealGameModules(); // triggers every real game package's registerGame() side effect.
  const { getGame, allGameIds } = await loadEngineRegistryHandle();

  const registeredIds = new Set(allGameIds());

  for (const id of ids) {
    if (!registeredIds.has(id)) {
      throw new RegistryLivenessError(
        `registry-liveness: packages/games/${id} exists but @party/engine's registry has no entry for "${id}" — was registerGame("${id}", ...) ever called from that package's own index.ts?`,
      );
    }
    const registered = getGame(id);
    if (!registered) {
      throw new RegistryLivenessError(`registry-liveness: allGameIds() lists "${id}" but getGame("${id}") returned nothing`);
    }
    assertRegistryEntryIsReal(id, registered.meta);
  }

  const serverSource = readFileSync(serverIndexSourcePath(), 'utf8');
  assertServerImportsEveryGame(serverSource, ids);

  return { checkedIds: ids };
}
