// Role-based view() filtering — the second-biggest leak risk in this
// project after Hold'em (per this wave's brief). Same "no substring leak"
// style as Hold'em's hole-card test: serialise the guesser's view to JSON
// and assert the true, still-hidden colour of every unrevealed tile is
// nowhere in it — not as a `color` field, not smuggled in via some other
// field, not even as a bare string anywhere in the payload.

import { describe, it, expect } from 'vitest';
import type { PlayerPublic } from '@party/protocol';
import { createRng } from '@party/engine';
import { codewordsModule, type CodewordsState } from './module.js';

function makePlayers(n: number): PlayerPublic[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    username: `p${i}`,
    seat: i,
    connected: true,
    isHost: i === 0,
  }));
}

function newGame(seed: number, playerCount = 6): CodewordsState {
  return codewordsModule.setup({ players: makePlayers(playerCount), rng: createRng(seed) });
}

describe('view() role-based filtering', () => {
  it("a guesser's view never contains the colour of any unrevealed tile, not even as a substring", () => {
    const state = newGame(101);
    const guesserId = Object.keys(state.playerRole).find((id) => state.playerRole[id] === 'guesser')!;

    const view = codewordsModule.view(state, guesserId);
    const serialized = JSON.stringify(view);

    const hiddenColors = new Set(state.tiles.filter((t) => !t.revealed).map((t) => t.color));
    // With a real 25-tile board this is always all four colours (some hidden
    // team0/team1/neutral tile always exists pre-game, and the one assassin
    // tile is always still hidden), so this guards the whole colour space.
    expect(hiddenColors.size).toBeGreaterThan(0);
    for (const color of hiddenColors) {
      expect(serialized).not.toContain(color);
    }
    expect(serialized).not.toContain('assassin');

    // Structural check, not just substring: no tile view carries a `color`
    // key unless it is actually revealed.
    for (const t of view.tiles) {
      const trueTile = state.tiles.find((x) => x.id === t.id)!;
      if (!trueTile.revealed) {
        expect(t).not.toHaveProperty('color');
      }
    }
  });

  it("a guesser's view reveals no more than what's already public: words yes, colours only once revealed", () => {
    const state = newGame(102);
    const guesserId = Object.keys(state.playerRole).find((id) => state.playerRole[id] === 'guesser')!;
    const view = codewordsModule.view(state, guesserId);

    expect(view.tiles).toHaveLength(state.tiles.length);
    for (const t of view.tiles) {
      const trueTile = state.tiles.find((x) => x.id === t.id)!;
      expect(t.word).toBe(trueTile.word); // words are always public — only colour is secret
      expect(t.revealed).toBe(false);
    }
  });

  it('both spymasters (either team) see the full key — every tile\'s true colour, revealed or not', () => {
    const state = newGame(103);
    for (const team of [0, 1] as const) {
      const spymasterId = state.teams[team].spymaster;
      const view = codewordsModule.view(state, spymasterId);
      for (const t of view.tiles) {
        const trueTile = state.tiles.find((x) => x.id === t.id)!;
        expect(t.color).toBe(trueTile.color);
      }
    }
  });

  it('once a tile is revealed, its colour becomes public to every viewer (a flipped card is public knowledge)', () => {
    const state = newGame(104);
    const revealedTile = state.tiles[0]!;
    const withReveal: CodewordsState = {
      ...state,
      tiles: state.tiles.map((t) => (t.id === revealedTile.id ? { ...t, revealed: true } : t)),
    };

    for (const id of Object.keys(withReveal.playerRole)) {
      const view = codewordsModule.view(withReveal, id);
      const tileView = view.tiles.find((t) => t.id === revealedTile.id)!;
      expect(tileView.revealed).toBe(true);
      expect(tileView.color).toBe(revealedTile.color);
    }
  });

  it("a viewer never sees another player's private `you` role/team misattributed to themselves", () => {
    const state = newGame(105);
    for (const id of Object.keys(state.playerRole)) {
      const view = codewordsModule.view(state, id);
      expect(view.you.team).toBe(state.playerTeam[id]);
      expect(view.you.role).toBe(state.playerRole[id]);
    }
  });

  it('team rosters (who is on which team, who is the spymaster) are public — not a secrecy leak', () => {
    // Unlike the colour key, team membership and the spymaster role are
    // knowledge every player at the table has (everyone can see who's
    // sitting where and who the two spymasters are) — only the *unrevealed
    // colour key* is secret. Every viewer's view should show identical
    // team/seat info.
    const state = newGame(106);
    const ids = Object.keys(state.playerRole);
    const views = ids.map((id) => codewordsModule.view(state, id));
    for (const v of views) {
      expect(v.teams).toEqual(views[0]!.teams);
      expect(v.turnTeam).toBe(views[0]!.turnTeam);
    }
  });
});
