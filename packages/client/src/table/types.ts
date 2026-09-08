// Owned by A5 (Wave 1). See docs/ARCHITECTURE.md §6 "The presenter contract"
// for the frozen shape of PresenterCtx.
//
// SeatLayout's canonical definition now lives in @party/presenter (moved
// there by the overseer after Wave 2 — see that package's src/index.ts for
// why: it broke a circular dependency between @party/client and the game
// packages). Re-exported here so every existing import of
// `from '../table/types.js'` / `from '@party/client'` keeps working
// unchanged.

export type { SeatLayout } from '@party/presenter';
