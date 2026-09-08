// Codewords — owned by A10 (Wave 2). See module.ts for the real rules
// (setup/reduce/view/currentActors/isTerminal/defaultAction) and
// presenter.ts for the 3D presentation. This file's only job is wiring the
// real module into the shared registry, overwriting the stub entry that
// was here before — see packages/engine/src/registry.ts's docstring for
// why every game package does this from its own entry file instead of
// editing the registry directly.
//
// IMPORTANT (legal, public repo): "Codewords" is this game's name in this
// project precisely to avoid using the trademarked title it is inspired
// by — do not rename it back. Its wordlist (./data/wordlist.ts) is
// originally authored for this repo, not copied from any published game.
//
// Rule modules (this file, module.ts) must not import Three.js — see
// presenter.ts for the client-side counterpart, which is the only file in
// this package allowed to.

import { registerGame } from '@party/engine';
import { codewordsModule } from './module.js';

registerGame('codewords', codewordsModule);

export { codewordsModule };
export default codewordsModule;
export type {
  CodewordsState,
  CodewordsAction,
  CodewordsView,
  CodewordsTileView,
  CodewordsTeamView,
  Tile,
  TileColor,
  Team,
  Role,
  Phase,
  Clue,
} from './module.js';
export { GRID_SIZE, BOARD_SIZE } from './module.js';
