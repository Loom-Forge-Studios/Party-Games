import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PlaceholderAssetLoader } from './placeholder-loader.js';
import { CARD_RANKS, type CardSuitCode } from './procedural/cards.js';
import { MEEPLE_COLORS } from './procedural/meeple.js';

const SUITS: CardSuitCode[] = ['S', 'H', 'D', 'C'];

describe('PlaceholderAssetLoader', () => {
  it('never rejects and never throws for a nonexistent key — falls back to a valid Object3D', async () => {
    const onWarn = vi.fn();
    const loader = new PlaceholderAssetLoader({ onWarn });

    const result = await loader.load('this/key/does/not/exist');

    expect(result).toBeInstanceOf(THREE.Object3D);
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0][0]).toContain('this/key/does/not/exist');
  });

  it('resolves (does not reject) even when load() is awaited directly, for a garbage key', () => {
    const loader = new PlaceholderAssetLoader({ onWarn: () => {} });
    return expect(loader.load('')).resolves.toBeInstanceOf(THREE.Object3D);
  });

  it('logs a warning to console.warn by default (no onWarn override)', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = new PlaceholderAssetLoader();
    await loader.load('totally-unknown');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('resolves every one of the 52 standard playing cards without falling back', async () => {
    const onWarn = vi.fn();
    const loader = new PlaceholderAssetLoader({ onWarn });

    for (const rank of CARD_RANKS) {
      for (const suit of SUITS) {
        const card = await loader.load(`card/${rank}${suit}`);
        expect(card).toBeInstanceOf(THREE.Object3D);
      }
    }

    expect(onWarn).not.toHaveBeenCalled();
  });

  it('resolves the card back, both checkers disc variants, the die, every meeple colour, and both table materials', async () => {
    const onWarn = vi.fn();
    const loader = new PlaceholderAssetLoader({ onWarn });

    const keys = [
      'card/back',
      'checkers/disc/light',
      'checkers/disc/dark',
      'dice/d6',
      'table/wood',
      'table/felt',
      ...Object.keys(MEEPLE_COLORS).map((c) => `meeple/${c}`),
    ];

    for (const key of keys) {
      const asset = await loader.load(key);
      expect(asset, `key "${key}" should resolve`).toBeInstanceOf(THREE.Object3D);
    }

    expect(onWarn).not.toHaveBeenCalled();
  });

  it('falls back gracefully for a malformed card key and an unknown meeple colour', async () => {
    const onWarn = vi.fn();
    const loader = new PlaceholderAssetLoader({ onWarn });

    await expect(loader.load('card/1Z')).resolves.toBeInstanceOf(THREE.Object3D);
    await expect(loader.load('meeple/chartreuse')).resolves.toBeInstanceOf(THREE.Object3D);
    expect(onWarn).toHaveBeenCalledTimes(2);
  });

  it('caches: the same key returns the same object on a second load', async () => {
    const loader = new PlaceholderAssetLoader({ onWarn: () => {} });
    const first = await loader.load('dice/d6');
    const second = await loader.load('dice/d6');
    expect(second).toBe(first);
  });

  it('each card mesh is named uniquely by rank/suit', async () => {
    const loader = new PlaceholderAssetLoader({ onWarn: () => {} });
    const ace = (await loader.load('card/AS')) as THREE.Object3D;
    const king = (await loader.load('card/KH')) as THREE.Object3D;
    expect(ace.name).toBe('card:AS');
    expect(king.name).toBe('card:KH');
  });
});
