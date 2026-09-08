// Owned by A5 (Wave 1).
//
// The shared 3D table scene: Three.js scene/renderer bootstrap, seat layout
// (world transforms + placeholder avatars around the table, indexed by
// seat number), and the PresenterCtx (see docs/ARCHITECTURE.md §6) that
// per-game presenters (Wave 2) mount into. Table code must never implement
// game rules — see the "rules/presenter split" invariant in
// docs/ARCHITECTURE.md §7.

export type { SeatLayout } from './types.js';

export {
  computeSeatLayout,
  seatDistance,
  MIN_SEATS,
  MAX_SEATS,
  SEAT_RING_RADIUS,
  MIN_NON_OVERLAP_DISTANCE,
  type SeatLayoutOptions,
} from './seat-layout.js';

export { createAvatarPlaceholder, AVATAR_FOOTPRINT_RADIUS, AVATAR_TOTAL_HEIGHT } from './avatar.js';

export { createScene, createTable, addLighting, TABLE_RADIUS, TABLE_HEIGHT, TABLE_SURFACE_Y } from './scene.js';

export {
  createRenderer,
  createRenderLoop,
  attachResizeHandling,
  createDefaultCamera,
  MAX_PIXEL_RATIO,
  type RenderLoopHandle,
} from './renderer.js';

export { PlaceholderAssetLoader } from './placeholder-asset-loader.js';

export { createPresenterCtx, type PresenterCtx, type CreatePresenterCtxOptions } from './presenter-ctx.js';
