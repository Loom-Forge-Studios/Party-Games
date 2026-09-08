// Owned by A5 (Wave 1). Pure scene-graph assembly — table mesh + lighting.
// Deliberately has no WebGLRenderer/canvas dependency here so it can be
// constructed and inspected headlessly (see seat-layout.test.ts and
// presenter-ctx.test.ts). Renderer bootstrap (which needs a real <canvas>
// and a GL context) lives in renderer.ts and is exercised manually in a
// browser — see the DoD note in the final report about what a unit test
// cannot cover.

import * as THREE from 'three';

export const TABLE_RADIUS = 1.3;
export const TABLE_HEIGHT = 0.08;
/** World-space Y of the table's playing surface — pieces sit at/above this. */
export const TABLE_SURFACE_Y = TABLE_HEIGHT;

/** The table mesh, centred at the origin, receiving shadows from seat avatars and pieces. */
export function createTable(): THREE.Object3D {
  const geometry = new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, TABLE_HEIGHT, 48);
  const material = new THREE.MeshStandardMaterial({ color: 0x2e5339, roughness: 0.85, metalness: 0 });
  const table = new THREE.Mesh(geometry, material);
  table.position.y = TABLE_HEIGHT / 2;
  table.receiveShadow = true;
  table.name = 'table';
  return table;
}

/** Ambient fill + a single shadow-casting key light, angled over the table. */
export function addLighting(scene: THREE.Scene): {
  ambient: THREE.AmbientLight;
  key: THREE.DirectionalLight;
} {
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  ambient.name = 'ambient-light';
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.name = 'key-light';
  key.position.set(2.5, 4.5, 2);
  key.target.position.set(0, TABLE_SURFACE_Y, 0);
  key.castShadow = true;
  // Modest shadow map — this must run acceptably on integrated graphics /
  // phones, not just a dev machine's discrete GPU.
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  scene.add(key);
  scene.add(key.target);

  return { ambient, key };
}

/** Assembles the base scene: an empty THREE.Scene with the table and lighting in it. Seats are added by the caller (see presenter-ctx.ts). */
export function createScene(): { scene: THREE.Scene; table: THREE.Object3D } {
  const scene = new THREE.Scene();
  const table = createTable();
  scene.add(table);
  addLighting(scene);
  return { scene, table };
}
