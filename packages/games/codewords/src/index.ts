// STUB ONLY — owned by A10 (Wave 2).
//
// Real Codewords rules (team-based word-association clue-giving game;
// setup/reduce/view/currentActors/isTerminal/defaultAction — the key card
// telling which words belong to which team must be hidden from guessers in
// view(), visible only to the current clue-giver) go here. See
// packages/games/checkers for the registerGame() pattern this file follows.
//
// IMPORTANT (legal, public repo): "Codewords" is this game's name in this
// project precisely to avoid using the trademarked title it is inspired by
// — do not rename it back. No third-party word lists may be copied in;
// original or CC0 word lists only, recorded in /ASSETS.md if sourced.
//
// Rule modules must not import Three.js and must route all randomness
// (word/board shuffling) through the injected Rng — never Math.random().

import { registerGame, IllegalAction, type GameModule } from '@party/engine';

interface CodewordsState {
  // Real board/team/key-card representation lands in Wave 2.
}

type CodewordsAction = unknown;
type CodewordsView = Record<string, never>;

const codewordsModule: GameModule<CodewordsState, CodewordsAction, CodewordsView> = {
  meta: {
    id: 'codewords',
    title: 'Codewords',
    minPlayers: 4,
    maxPlayers: 8,
    teams: { count: 2, minPerTeam: 2 },
    estMinutes: 20,
    summary: 'Team word-association clue game. Rules not implemented yet.',
  },
  setup: () => ({}),
  reduce: () => {
    throw new IllegalAction('codewords: no rules implemented yet');
  },
  view: () => ({}),
  currentActors: () => [],
  isTerminal: () => null,
  defaultAction: () => {
    throw new IllegalAction('codewords: no default action implemented yet');
  },
};

registerGame('codewords', codewordsModule);

export default codewordsModule;
