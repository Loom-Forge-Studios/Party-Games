// Owned by A5 (Wave 1). Minimal stand-in for A7's real AssetLoader
// (packages/assets/src/loader.ts — type-only seam, see that file's header).
// Used as PresenterCtx.assets' default so this package's own smoke tests,
// and Wave 2 game presenters once that wave starts, aren't blocked on A7's
// real implementation landing first.
//
// IMPORTANT: swap this for @party/assets' real AssetLoader once A7's PR
// merges — see the final report for this wave's note on that.

import * as THREE from 'three';
import type { AssetLoader } from '@party/assets';

const PLACEHOLDER_MATERIAL = () => new THREE.MeshStandardMaterial({ color: 0xcc8844, roughness: 0.7 });

export class PlaceholderAssetLoader implements AssetLoader {
  /** Always resolves to a plain box mesh, tagged with the requested key for debugging. Never rejects — matches the AssetLoader contract's "graceful fallback" note. */
  async load(key: string): Promise<unknown> {
    const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const mesh = new THREE.Mesh(geometry, PLACEHOLDER_MATERIAL());
    mesh.name = `placeholder-asset:${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
