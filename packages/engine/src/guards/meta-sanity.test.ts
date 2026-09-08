import { describe, expect, it } from 'vitest';
import { assertMetaSanity, MetaSanityError } from './meta-sanity.js';
import { discoverGameIdsFromDisk, loadRealGameModule } from './real-game-loader.js';

describe('meta-sanity guard — positive controls (fixtures that SHOULD fail)', () => {
  it('rejects minPlayers > maxPlayers', () => {
    expect(() =>
      assertMetaSanity({ id: 'fixture-bad-range', title: 'Fixture', minPlayers: 5, maxPlayers: 2, summary: 'x' }),
    ).toThrow(MetaSanityError);
  });

  it('rejects a non-positive teams.minPerTeam', () => {
    expect(() =>
      assertMetaSanity({
        id: 'fixture-bad-min-per-team',
        title: 'Fixture',
        minPlayers: 4,
        maxPlayers: 8,
        teams: { count: 2, minPerTeam: 0 },
        summary: 'x',
      }),
    ).toThrow(MetaSanityError);
  });

  it('rejects teams.minPerTeam that minPlayers could never field', () => {
    // 4 minPlayers / 2 teams = 2 per team max, but this claims 3 are required.
    expect(() =>
      assertMetaSanity({
        id: 'fixture-overcommitted-teams',
        title: 'Fixture',
        minPlayers: 4,
        maxPlayers: 8,
        teams: { count: 2, minPerTeam: 3 },
        summary: 'x',
      }),
    ).toThrow(MetaSanityError);
  });

  it('negative control: a sane meta with no teams passes cleanly', () => {
    expect(() => assertMetaSanity({ id: 'fixture-sane', title: 'Fixture', minPlayers: 2, maxPlayers: 8, summary: 'x' })).not.toThrow();
  });

  it('negative control: a sane meta with well-formed teams passes cleanly', () => {
    expect(() =>
      assertMetaSanity({
        id: 'fixture-sane-teams',
        title: 'Fixture',
        minPlayers: 4,
        maxPlayers: 8,
        teams: { count: 2, minPerTeam: 2 },
        summary: 'x',
      }),
    ).not.toThrow();
  });
});

describe('meta-sanity guard — the three real v1 games', () => {
  for (const id of discoverGameIdsFromDisk()) {
    it(`"${id}"'s real meta passes cleanly`, async () => {
      const module = await loadRealGameModule(id);
      expect(() => assertMetaSanity(module.meta)).not.toThrow();
    });
  }
});
