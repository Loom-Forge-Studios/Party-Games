import * as THREE from 'three';

export type CheckersVariant = 'light' | 'dark';

const DISC_COLOR: Record<CheckersVariant, number> = {
  light: 0xe8dcc8,
  dark: 0x3a2a1a,
};

// A shade darker (light piece) / lighter (dark piece) than the body colour,
// for the shallow decorative ring stamped into the top face below — real
// turned/molded checkers pieces almost always have some kind of concentric
// detail there rather than a perfectly featureless top.
const RING_COLOR: Record<CheckersVariant, number> = {
  light: 0xcdbb9c,
  dark: 0x55402a,
};

// Sized against packages/games/checkers/src/layout.ts's CELL_SIZE = 0.18:
// radius ~40% of a cell so the disc reads as a distinct piece with a visible
// gap to its neighbours, height keeps the same height/diameter ratio (~0.17)
// a real checkers piece has. Keep DISC_HEIGHT in sync with layout.ts's own
// copy of this constant (see that file's comment).
const DISC_RADIUS = 0.072;
const DISC_HEIGHT = 0.025;

// A single flat-ended cylinder reads as "resized placeholder box," not a
// real game piece — real checkers pieces are turned/molded with a rounded
// or chamfered edge, never a sharp 90-degree corner. Carve that edge out of
// three stacked cylinder sections (a shrinking frustum at each end, a
// straight body between them) rather than one flat one; this is the
// "second, slightly smaller/offset cylinder stacked on top" technique, run
// twice. All three sections share one radial-segment count so their seams
// line up exactly.
const BEVEL_INSET = DISC_RADIUS * 0.16;
const BEVEL_HEIGHT = DISC_HEIGHT * 0.22;
const BODY_HEIGHT = DISC_HEIGHT - BEVEL_HEIGHT * 2;
const RADIAL_SEGMENTS = 32;

// The decorative ring: a thin torus inset from the (now chamfered) edge and
// sitting flush with the top face, borrowing the same primitive
// presenter.ts's buildKingMarker() uses for the crown indicator — but much
// smaller/subtler and coloured as part of the piece itself, so it reads as
// a manufacturing detail rather than another UI marker.
const RING_RADIUS = DISC_RADIUS * 0.72;
const RING_TUBE = DISC_RADIUS * 0.045;

function buildBevelSection(material: THREE.Material, radiusTop: number, radiusBottom: number, y: number): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, BEVEL_HEIGHT, RADIAL_SEGMENTS);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  mesh.castShadow = true;
  return mesh;
}

/**
 * A checkers disc: a squat cylinder with a chamfered top/bottom edge (three
 * stacked cylinder sections, see BEVEL_INSET/BEVEL_HEIGHT above) and a
 * shallow decorative ring stamped into the top face, in one of two colours.
 * `checkers/disc/<light|dark>`.
 *
 * Returns a Group rather than a single Mesh — presenter.ts's syncPiece()
 * only ever treats the returned object generically (position/userData/
 * castShadow/clone), so this is a transparent change for every caller; the
 * per-section castShadow flags above are set here rather than relying on a
 * caller setting it on the group, since Object3D.castShadow has no effect
 * except on the Mesh instances that actually carry geometry.
 */
export function buildCheckersDisc(variant: CheckersVariant): THREE.Object3D {
  const material = new THREE.MeshStandardMaterial({ color: DISC_COLOR[variant], roughness: 0.45 });
  const ringMaterial = new THREE.MeshStandardMaterial({ color: RING_COLOR[variant], roughness: 0.55 });

  const halfBody = BODY_HEIGHT / 2;
  const bevelCenter = halfBody + BEVEL_HEIGHT / 2;

  const group = new THREE.Group();

  const bottomBevel = buildBevelSection(material, DISC_RADIUS, DISC_RADIUS - BEVEL_INSET, -bevelCenter);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(DISC_RADIUS, DISC_RADIUS, BODY_HEIGHT, RADIAL_SEGMENTS), material);
  body.castShadow = true;
  const topBevel = buildBevelSection(material, DISC_RADIUS - BEVEL_INSET, DISC_RADIUS, bevelCenter);
  group.add(bottomBevel, body, topBevel);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 8, 24), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = DISC_HEIGHT / 2;
  ring.castShadow = true;
  group.add(ring);

  group.name = `checkers:disc:${variant}`;
  return group;
}
