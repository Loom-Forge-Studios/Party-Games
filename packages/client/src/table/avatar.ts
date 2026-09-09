// Owned by A5 (Wave 1). Placeholder avatar body for a seat: a capsule +
// nameplate. Real per-player character models are A7's later work — see
// PresenterCtx.assets and packages/assets. This placeholder exists so
// seating/camera/table plumbing can be built and tested now.

import * as THREE from 'three';

const CAPSULE_RADIUS = 0.22;
const CAPSULE_CYLINDER_HEIGHT = 0.9;
export const AVATAR_FOOTPRINT_RADIUS = CAPSULE_RADIUS;
export const AVATAR_TOTAL_HEIGHT = CAPSULE_CYLINDER_HEIGHT + CAPSULE_RADIUS * 2;

/**
 * A capsule body + nameplate, already assembled but NOT yet positioned in
 * world space — the caller (seat-layout.ts) sets position/rotation on the
 * returned group.
 *
 * `isLocal` now also controls visibility, not just tint (P3 first-person
 * rework): the local seat's own camera sits at this exact avatar's position
 * (see seat-layout.ts's computeHomeCameraPose) — rendering the local
 * player's own body/nameplate there would mean staring at the inside of
 * your own head. Only *this* seat's own client hides them; every other
 * client renders its own local scene the same way, so everyone else still
 * sees this player's avatar normally from their own seat. The mesh and
 * nameplate are still built and added to the group (kept `visible = false`
 * rather than omitted) so the scene graph shape stays uniform across seats
 * for anything inspecting it (tests, focus-hint object resolution).
 */
export function createAvatarPlaceholder(label: string, isLocal: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = `avatar:${label}`;

  const bodyGeometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_CYLINDER_HEIGHT, 4, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: isLocal ? 0x4a90d9 : 0x8a8f98,
    roughness: 0.6,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = 'avatar-body';
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.y = AVATAR_TOTAL_HEIGHT / 2;
  body.visible = !isLocal;
  group.add(body);

  const nameplate = createNameplate(label);
  nameplate.position.y = AVATAR_TOTAL_HEIGHT + 0.18;
  nameplate.visible = !isLocal;
  group.add(nameplate);

  return group;
}

/**
 * Text is rendered via a 2D canvas texture, which needs `document`. In a
 * headless test environment (Vitest's default 'node' env — see
 * vitest.config.ts) that's unavailable, so this falls back to an inert,
 * fully-transparent plane of the same rough footprint. The fallback keeps
 * scene-graph shape/positioning identical for tests without pulling in
 * jsdom just to draw text nobody in a unit test reads.
 */
function createNameplate(label: string): THREE.Object3D {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    const geometry = new THREE.PlaneGeometry(0.6, 0.16);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const plane = new THREE.Mesh(geometry, material);
    plane.name = 'nameplate-placeholder';
    return plane;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const geometry = new THREE.PlaneGeometry(0.6, 0.16);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const plane = new THREE.Mesh(geometry, material);
    plane.name = 'nameplate-placeholder';
    return plane;
  }

  ctx.fillStyle = 'rgba(15, 20, 15, 0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = '32px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'nameplate';
  sprite.scale.set(0.8, 0.2, 1);
  return sprite;
}
