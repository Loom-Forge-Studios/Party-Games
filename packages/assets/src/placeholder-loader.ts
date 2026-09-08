import type { AssetLoader } from './loader.js';
import { buildCheckersDisc, type CheckersVariant } from './procedural/checkers.js';
import { buildCardBack, buildPlayingCard, parseCardKey } from './procedural/cards.js';
import { buildDie } from './procedural/dice.js';
import { buildMeeple, isMeepleColorName } from './procedural/meeple.js';
import { buildTableSwatch, type TableMaterialKind } from './procedural/table.js';
import { buildFallbackPrimitive } from './procedural/fallback.js';

/**
 * Key scheme for `PlaceholderAssetLoader`, and — until real named assets
 * (Kenney/Quaternius/Poly Pizza, see ASSETS.md) land alongside or in place
 * of these — the scheme every caller (table, game presenters) should use:
 *
 *   checkers/disc/light        checkers/disc/dark
 *   card/<RANK><SUIT>           RANK: A,2..10,J,Q,K   SUIT: S,H,D,C
 *   card/back
 *   dice/d6
 *   meeple/<color>              red,blue,green,yellow,purple,orange,white,black
 *   table/wood                  table/felt
 *
 * Any other key — a typo, a not-yet-built real asset, a key from a future
 * game this loader doesn't know about yet — resolves to a visibly-marked
 * placeholder primitive instead of failing. That's the whole point: no v1
 * game should ever be unable to render for want of an asset.
 */
function resolveKey(key: string): (() => unknown) | undefined {
  if (key === 'checkers/disc/light' || key === 'checkers/disc/dark') {
    const variant = key.slice('checkers/disc/'.length) as CheckersVariant;
    return () => buildCheckersDisc(variant);
  }

  if (key === 'card/back') {
    return () => buildCardBack();
  }
  const card = parseCardKey(key);
  if (card) {
    return () => buildPlayingCard(card.rank, card.suit);
  }

  if (key === 'dice/d6') {
    return () => buildDie();
  }

  if (key.startsWith('meeple/')) {
    const color = key.slice('meeple/'.length);
    if (isMeepleColorName(color)) {
      return () => buildMeeple(color);
    }
    return undefined;
  }

  if (key === 'table/wood' || key === 'table/felt') {
    const kind = key.slice('table/'.length) as TableMaterialKind;
    return () => buildTableSwatch(kind);
  }

  return undefined;
}

export interface PlaceholderAssetLoaderOptions {
  /** Called instead of `console.warn` for every fallback, e.g. in tests. */
  onWarn?: (message: string) => void;
}

/**
 * The real `AssetLoader`: builds every v1 placeholder asset procedurally
 * (see `procedural/*`, ASSETS.md's header for third-party assets — there
 * are none as of Wave 1) and never rejects or throws. An unrecognised or
 * failing key logs a warning and resolves to a visibly-marked placeholder
 * primitive instead.
 */
export class PlaceholderAssetLoader implements AssetLoader {
  private readonly warn: (message: string) => void;
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(options: PlaceholderAssetLoaderOptions = {}) {
    this.warn = options.onWarn ?? ((message) => console.warn(`[@party/assets] ${message}`));
  }

  async load(key: string): Promise<unknown> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const promise = this.build(key);
    this.cache.set(key, promise);
    return promise;
  }

  private async build(key: string): Promise<unknown> {
    const factory = resolveKey(key);
    if (!factory) {
      this.warn(`no asset registered for key "${key}" — using placeholder primitive`);
      return buildFallbackPrimitive(key);
    }
    try {
      return factory();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.warn(`failed to build asset for key "${key}" (${reason}) — using placeholder primitive`);
      return buildFallbackPrimitive(key);
    }
  }
}
