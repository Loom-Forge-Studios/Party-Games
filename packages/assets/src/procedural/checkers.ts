import * as THREE from 'three';

export type CheckersVariant = 'light' | 'dark';

const DISC_COLOR: Record<CheckersVariant, number> = {
  light: 0xe8dcc8,
  dark: 0x3a2a1a,
};

const DISC_RADIUS = 0.4;
const DISC_HEIGHT = 0.14;

/** A checkers disc: a flat cylinder in one of two colours. `checkers/disc/<light|dark>`. */
export function buildCheckersDisc(variant: CheckersVariant): THREE.Object3D {
  const geometry = new THREE.CylinderGeometry(DISC_RADIUS, DISC_RADIUS, DISC_HEIGHT, 32);
  const material = new THREE.MeshStandardMaterial({ color: DISC_COLOR[variant], roughness: 0.5 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `checkers:disc:${variant}`;
  return mesh;
}
