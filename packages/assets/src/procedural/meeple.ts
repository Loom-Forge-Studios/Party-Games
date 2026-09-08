import * as THREE from 'three';

/**
 * Fixed named palette for placeholder player-avatar bodies. Deliberately
 * small and generic — not tied to any specific game's team colours.
 */
export const MEEPLE_COLORS = {
  red: 0xc0392b,
  blue: 0x2e6fb3,
  green: 0x2e8b57,
  yellow: 0xd4ac0d,
  purple: 0x7d3c98,
  orange: 0xd35400,
  white: 0xe8e8e8,
  black: 0x2b2b2b,
} as const;

export type MeepleColorName = keyof typeof MEEPLE_COLORS;

export function isMeepleColorName(name: string): name is MeepleColorName {
  return Object.prototype.hasOwnProperty.call(MEEPLE_COLORS, name);
}

/**
 * A simple stylised avatar body — a peg/meeple silhouette built from
 * primitives (rounded body + head), not any specific board game's
 * copyrighted piece shape. `meeple/<color>`.
 */
export function buildMeeple(color: MeepleColorName): THREE.Object3D {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: MEEPLE_COLORS[color], roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.32, 4, 12), material);
  body.position.y = 0.28;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), material);
  head.position.y = 0.56;
  group.add(head);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 16), material);
  base.position.y = 0.03;
  group.add(base);

  group.name = `meeple:${color}`;
  return group;
}
