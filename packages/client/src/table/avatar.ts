// Owned by A5 (Wave 1). Avatar body for a seat: a low-poly primitive
// humanoid (head/torso/arms/legs) + nameplate. Real per-player character
// models are A7's later work — see PresenterCtx.assets and packages/assets.
// This procedural figure exists so seating/camera/table plumbing has
// something that reads as "a person standing at the table" rather than a
// pill, while staying cheap enough for 8 seats on modest hardware (six
// primitive meshes per avatar, no textures).

import * as THREE from 'three';

// ---- body proportions ------------------------------------------------------
// Everything is sized so the assembled figure stands with its feet at local
// y=0 (the group's own origin — seat-layout.ts positions the group at the
// seat's standing spot on the floor) and its head top at y=AVATAR_TOTAL_HEIGHT.
// Each part's *own* height is computed from its geometry params (capsules add
// 2x radius to their cylindrical "length" for the rounded caps) so
// AVATAR_TOTAL_HEIGHT stays an honest sum of what's actually built below,
// not a hand-picked number that can drift out of sync with the geometry.

const LEG_RADIUS = 0.07;
const LEG_LENGTH = 0.34; // cylindrical part of the leg capsule, excludes rounded caps
const LEG_HEIGHT = LEG_LENGTH + LEG_RADIUS * 2;

const TORSO_WIDTH = 0.36;
const TORSO_DEPTH = 0.2;
const TORSO_HEIGHT = 0.5;

const NECK_GAP = 0.02; // small gap between torso top and head so they read as separate forms
const HEAD_RADIUS = 0.14;

/** Total standing height, feet to top of head — see seat-layout.ts's EYE_HEIGHT, which is a fraction of this. */
export const AVATAR_TOTAL_HEIGHT = LEG_HEIGHT + TORSO_HEIGHT + NECK_GAP + HEAD_RADIUS * 2;

const ARM_RADIUS = 0.055;
const ARM_LENGTH = 0.3;
const ARM_HEIGHT = ARM_LENGTH + ARM_RADIUS * 2;
/** Horizontal gap between the torso's side and the arm capsule's inner edge. */
const ARM_TORSO_GAP = 0.015;
/** Distance from the body's centre axis to each arm capsule's own centre. */
const ARM_X_OFFSET = TORSO_WIDTH / 2 + ARM_RADIUS + ARM_TORSO_GAP;

/**
 * Widest point of the figure's silhouette from its centre axis — the arms
 * hanging at the sides stick out further than the torso or legs do. Used by
 * seat-layout.ts's MIN_NON_OVERLAP_DISTANCE for the seat-spacing collision
 * check, so this needs to be an honest outer radius, not a loose estimate.
 */
export const AVATAR_FOOTPRINT_RADIUS = ARM_X_OFFSET + ARM_RADIUS;

// y (feet=0) of the top of the torso, i.e. shoulder line.
const SHOULDER_Y = LEG_HEIGHT + TORSO_HEIGHT;

/**
 * A low-poly primitive humanoid (six meshes: head, torso, two arms, two
 * legs) + nameplate, already assembled but NOT yet positioned in world
 * space — the caller (seat-layout.ts) sets position/rotation on the
 * returned group.
 *
 * `isLocal` also controls visibility, not just tint (P3 first-person
 * rework): the local seat's own camera sits at this exact avatar's position
 * (see seat-layout.ts's computeHomeCameraPose) — rendering the local
 * player's own body/nameplate there would mean staring at the inside of
 * your own head. Only *this* seat's own client hides them; every other
 * client renders its own local scene the same way, so everyone else still
 * sees this player's avatar normally from their own seat. Every body-part
 * mesh lives inside one `avatar-body`-named group so a single
 * `bodyGroup.visible` toggle hides the whole figure at once — the group and
 * its children are still built and added (kept invisible rather than
 * omitted) so the scene graph shape stays uniform across seats for anything
 * inspecting it (tests, focus-hint object resolution).
 */
export function createAvatarPlaceholder(label: string, isLocal: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = `avatar:${label}`;

  const bodyColor = isLocal ? 0x4a90d9 : 0x8a8f98;
  const clothingMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.65 });
  // A neutral skin-like tone for the head, independent of the isLocal tint —
  // the nameplate/clothing colour already carries the "this is you" signal;
  // the face just needs to read as a face.
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.7 });

  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'avatar-body';

  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 12, 8), skinMaterial);
  head.name = 'avatar-head';
  head.position.y = LEG_HEIGHT + TORSO_HEIGHT + NECK_GAP + HEAD_RADIUS;
  head.castShadow = true;
  head.receiveShadow = true;
  bodyGroup.add(head);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(TORSO_WIDTH, TORSO_HEIGHT, TORSO_DEPTH), clothingMaterial);
  torso.name = 'avatar-torso';
  torso.position.y = LEG_HEIGHT + TORSO_HEIGHT / 2;
  torso.castShadow = true;
  torso.receiveShadow = true;
  bodyGroup.add(torso);

  for (const side of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(ARM_RADIUS, ARM_LENGTH, 4, 8), clothingMaterial);
    arm.name = `avatar-arm-${side < 0 ? 'left' : 'right'}`;
    arm.position.set(side * ARM_X_OFFSET, SHOULDER_Y - ARM_HEIGHT / 2, 0);
    arm.castShadow = true;
    arm.receiveShadow = true;
    bodyGroup.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(LEG_RADIUS, LEG_LENGTH, 4, 8), clothingMaterial);
    leg.name = `avatar-leg-${side < 0 ? 'left' : 'right'}`;
    // Legs sit closer to the centre axis than the arms do, side-by-side under the torso.
    leg.position.set(side * (TORSO_WIDTH / 4), LEG_HEIGHT / 2, 0);
    leg.castShadow = true;
    leg.receiveShadow = true;
    bodyGroup.add(leg);
  }

  bodyGroup.visible = !isLocal;
  group.add(bodyGroup);

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
