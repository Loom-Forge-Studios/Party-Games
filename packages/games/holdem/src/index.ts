// STUB ONLY — owned by A9 (Wave 2).
//
// Real Hold'em poker rules (setup/reduce/view/currentActors/isTerminal/
// defaultAction — betting rounds, hand evaluation, pot/side-pot handling,
// hole cards hidden per-viewer in view()) go here. See packages/games/checkers
// for the registerGame() pattern this file follows.
//
// Rule modules must not import Three.js and must route all randomness
// (deck shuffling!) through the injected Rng — never Math.random().

import { registerGame, IllegalAction, type GameModule } from '@party/engine';

interface HoldemState {
  // Real table/deck/pot representation lands in Wave 2.
}

type HoldemAction = unknown;
type HoldemView = Record<string, never>;

const holdemModule: GameModule<HoldemState, HoldemAction, HoldemView> = {
  meta: {
    id: 'holdem',
    title: "Hold'em Poker",
    minPlayers: 2,
    maxPlayers: 8,
    estMinutes: 30,
    summary: 'Community-card poker with betting rounds. Rules not implemented yet.',
  },
  setup: () => ({}),
  reduce: () => {
    throw new IllegalAction('holdem: no rules implemented yet');
  },
  view: () => ({}),
  currentActors: () => [],
  isTerminal: () => null,
  defaultAction: () => {
    throw new IllegalAction('holdem: no default action implemented yet');
  },
};

registerGame('holdem', holdemModule);

export default holdemModule;
