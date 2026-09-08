// Team assignment + balance validation — DoD item for this wave.
//
// The concrete rule (documented on codewordsModule.meta.teams, and again on
// setup() in module.ts): teams: { count: 2, minPerTeam: 2 }. The room is
// only startable when the player count splits evenly into exactly 2 teams
// (`players.length % 2 === 0`) with at least 2 per team (a spymaster + at
// least 1 guesser, i.e. `players.length / 2 >= 2`, i.e. `players.length >=
// 4`). That rule lives in packages/server/src/rooms/room-manager.ts's
// computeStartable() (this package doesn't depend on @party/server, so it
// can't import that function directly) — this test reimplements the exact
// same formula against this module's own `meta.teams`/`minPlayers` so the
// rule is pinned here too, and pairs it with setup()'s own defensive check
// of the identical bound (see module.test.ts's "rejects an undersized or
// unbalanced player count" test for that half).

import { describe, it, expect } from 'vitest';
import { createRng } from '@party/engine';
import { codewordsModule } from './module.js';

/** Mirrors packages/server/src/rooms/room-manager.ts's computeStartable(), scoped to the teams check, so this package can pin the exact rule without depending on @party/server. */
function isStartableTeamSize(playerCount: number): { ok: boolean; reason?: string } {
  const { meta } = codewordsModule;
  if (playerCount < meta.minPlayers) return { ok: false, reason: `needs ${meta.minPlayers}+ players` };
  if (playerCount > meta.maxPlayers) return { ok: false, reason: `too many players (max ${meta.maxPlayers})` };
  const teams = meta.teams!;
  if (playerCount % teams.count !== 0) return { ok: false, reason: 'needs even teams' };
  if (playerCount / teams.count < teams.minPerTeam) {
    return { ok: false, reason: `needs at least ${teams.minPerTeam} players per team` };
  }
  return { ok: true };
}

describe('team validation (startable rule)', () => {
  it('rejects the 3-player case named in this wave\'s brief', () => {
    const result = isStartableTeamSize(3);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(`needs ${codewordsModule.meta.minPlayers}+ players`);
  });

  it('rejects any undersized (<4) or odd player count', () => {
    for (const n of [1, 2, 3, 5, 7]) {
      expect(isStartableTeamSize(n).ok).toBe(false);
    }
  });

  it('accepts every even count in [minPlayers, maxPlayers] — a spymaster + 1+ guesser per side', () => {
    for (const n of [4, 6, 8]) {
      expect(isStartableTeamSize(n)).toEqual({ ok: true });
    }
  });

  it('rejects a count above maxPlayers', () => {
    expect(isStartableTeamSize(10).ok).toBe(false);
  });

  it('the same bound is enforced defensively inside setup() itself, not just at the lobby', () => {
    const players = Array.from({ length: 3 }, (_, i) => ({
      id: `p${i}`,
      username: `p${i}`,
      seat: i,
      connected: true,
      isHost: i === 0,
    }));
    expect(() => codewordsModule.setup({ players, rng: createRng(1) })).toThrow();
  });
});
