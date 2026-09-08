import * as THREE from 'three';
import { buildNoiseTexture } from './canvas.js';

export type TableMaterialKind = 'wood' | 'felt';

/**
 * Procedural table-surface materials (wood grain / felt nap), built from
 * colour + deterministic noise — never a photograph. `table/<wood|felt>`.
 *
 * `AssetLoader.load()` can only hand back an `Object3D`, so this returns a
 * flat swatch `Mesh` sized 1x1 world unit; a caller building the actual
 * table geometry (the `table/` module, A5) is expected to either parent
 * this swatch or, more likely, pull `.material` off it and apply that to
 * its own tabletop geometry — both are valid given the untyped `unknown`
 * return, and `material` is documented here for callers who narrow to
 * `THREE.Mesh`.
 */
export function buildTableSwatch(kind: TableMaterialKind): THREE.Object3D {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = kind === 'wood' ? buildWoodMaterial() : buildFeltMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = `table:${kind}`;
  return mesh;
}

function buildWoodMaterial(): THREE.MeshStandardMaterial {
  const map = buildNoiseTexture(128, [122, 78, 42], [28, 20, 14], 11, 'horizontal');
  return new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.02 });
}

function buildFeltMaterial(): THREE.MeshStandardMaterial {
  const map = buildNoiseTexture(128, [24, 92, 58], [10, 10, 10], 29, 'none');
  return new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
}
