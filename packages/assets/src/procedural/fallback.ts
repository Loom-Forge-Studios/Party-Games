import * as THREE from 'three';
import { buildCheckerboardTexture } from './canvas.js';

/**
 * The universal "missing asset" placeholder: a magenta/black checkerboard
 * cube, the standard convention for "this render engine knows a mesh
 * belongs here but not what it should look like". Used whenever
 * `AssetLoader.load()` is given a key it doesn't recognise, or when
 * building a recognised key throws — this function itself must not throw.
 */
export function buildFallbackPrimitive(key: string): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const material = new THREE.MeshBasicMaterial({ map: buildCheckerboardTexture() });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `placeholder:${key}`;
  return mesh;
}
