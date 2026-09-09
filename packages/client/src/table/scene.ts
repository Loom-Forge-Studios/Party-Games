// Owned by A5 (Wave 1). Pure scene-graph assembly — table mesh + lighting.
// Deliberately has no WebGLRenderer/canvas dependency here so it can be
// constructed and inspected headlessly (see seat-layout.test.ts and
// presenter-ctx.test.ts). Renderer bootstrap (which needs a real <canvas>
// and a GL context) lives in renderer.ts and is exercised manually in a
// browser — see the DoD note in the final report about what a unit test
// cannot cover.

import * as THREE from 'three';
// Canonical values now live in @party/presenter (overseer, post-Wave-2) so
// a game presenter can use them without depending on @party/client — see
// that package's src/index.ts. Re-exported here for source compatibility.
import { TABLE_RADIUS, TABLE_HEIGHT, TABLE_SURFACE_Y } from '@party/presenter';
export { TABLE_RADIUS, TABLE_HEIGHT, TABLE_SURFACE_Y };

// Real CC0 texture (see /ASSETS.md) — served from packages/client/public/,
// so Vite serves it at this absolute path in both dev and the built site.
// Loaded directly via THREE.TextureLoader rather than through
// PresenterCtx.assets: createTable() runs inside createScene(), which
// createPresenterCtx() calls synchronously before ctx.assets even exists
// (see presenter-ctx.ts) — going through the async AssetLoader seam here
// would mean making scene/ctx assembly async across every call site. A
// TextureLoader load is fire-and-forget: the mesh renders with the
// material's base color until the image decodes, then table-mount.ts's
// continuous per-frame render loop (see its own comment on why it never
// idles while a table is mounted) naturally picks up the texture on a
// later frame — no extra wiring needed.
const TABLE_WOOD_TEXTURE_URL = '/assets/textures/table-wood-diffuse.jpg';

/** The table mesh, centred at the origin, receiving shadows from seat avatars and pieces. */
export function createTable(): THREE.Object3D {
  const geometry = new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, TABLE_HEIGHT, 48);
  const material = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.35, metalness: 0.05 });
  // TextureLoader.load() reaches for `document` internally (to build an
  // <img>) — unavailable under Vitest's default 'node' environment, same
  // constraint avatar.ts's createNameplate() and codewords/presenter.ts's
  // canvasAvailable() already guard against. Fall back to the plain wood-
  // brown color above so this stays constructible headlessly.
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const map = new THREE.TextureLoader().load(TABLE_WOOD_TEXTURE_URL);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    material.map = map;
    material.color.set(0xffffff);
  }
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
