import { describe, expect, it } from 'vitest';
import {
  assertRegistryEntryIsReal,
  assertRegistryReflectsRealGames,
  assertServerImportsEveryGame,
  RegistryLivenessError,
} from './registry-liveness.js';
import { discoverGameIdsFromDisk } from './real-game-loader.js';

// ---------------------------------------------------------------------------
// Positive controls. These feed the two small pure checks a deliberately
// broken fixture input rather than actually breaking packages/server or
// packages/engine/src/registry.ts, which this package doesn't own — see
// registry-liveness.ts's own header for why the guard is split this way.
// "A guard nobody has watched fail is not known to work."
// ---------------------------------------------------------------------------

describe('registry-liveness guard — positive controls (fixtures that SHOULD fail)', () => {
  it('rejects a registry entry whose summary is still the Wave-1 stub placeholder', () => {
    expect(() => assertRegistryEntryIsReal('checkers', { summary: 'Checkers — rules not implemented yet.' })).toThrow(
      RegistryLivenessError,
    );
  });

  it('accepts a registry entry with a real summary', () => {
    expect(() => assertRegistryEntryIsReal('checkers', { summary: 'Classic diagonal-move capture game.' })).not.toThrow();
  });

  it('rejects a server source missing one of the required imports', () => {
    const brokenSource = `import '@party/game-checkers';\nimport '@party/game-holdem';\n// codewords import missing\n`;
    expect(() => assertServerImportsEveryGame(brokenSource, ['checkers', 'holdem', 'codewords'])).toThrow(
      /does not import "@party\/game-codewords"/,
    );
  });

  it('accepts a server source that imports every required game package', () => {
    const okSource = `import '@party/game-checkers';\nimport '@party/game-holdem';\nimport '@party/game-codewords';\n`;
    expect(() => assertServerImportsEveryGame(okSource, ['checkers', 'holdem', 'codewords'])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The real thing: every packages/games/* directory, the real registry, and
// the real (read-only) packages/server/src/index.ts.
// ---------------------------------------------------------------------------

describe('registry-liveness guard — the real registry and server wiring', () => {
  it('reflects all three real v1 games with no stub summaries left, and the server imports every one', async () => {
    const result = await assertRegistryReflectsRealGames();
    expect(new Set(result.checkedIds)).toEqual(new Set(discoverGameIdsFromDisk()));
    expect(result.checkedIds).toEqual(expect.arrayContaining(['checkers', 'holdem', 'codewords']));
  });
});
