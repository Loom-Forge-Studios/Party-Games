// Owned by A6 (Wave 1).
//
// CameraDirector/CameraPose's canonical definitions now live in
// @party/presenter (moved there by the overseer after Wave 2 — see that
// package's src/index.ts for why: it broke a circular dependency between
// @party/client and the game packages). Re-exported here so every existing
// import of `from '../camera/director.js'` / `from '@party/client'` keeps
// working unchanged. `ThreeCameraDirector` (CameraDirector.ts) is the real
// implementation and is unaffected by this move.

export type { CameraDirector, CameraPose } from '@party/presenter';
