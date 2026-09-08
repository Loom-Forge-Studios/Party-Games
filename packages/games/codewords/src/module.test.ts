import { describe, it, expect } from 'vitest';
import type { PlayerPublic, PlayerId } from '@party/protocol';
import { createRng, IllegalAction, type ReduceCtx, type Rng } from '@party/engine';
import {
  codewordsModule,
  GRID_SIZE,
  BOARD_SIZE,
  STARTING_TEAM_TILES,
  OTHER_TEAM_TILES,
  NEUTRAL_TILES,
  ASSASSIN_TILES,
  type CodewordsState,
  type Team,
} from './module.js';
import { WORDLIST } from './data/wordlist.js';

function makePlayers(n: number): PlayerPublic[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    username: `p${i}`,
    seat: i,
    connected: true,
    isHost: i === 0,
  }));
}

function newGame(seed: number, playerCount = 4): { state: CodewordsState; players: PlayerPublic[]; rng: Rng } {
  const players = makePlayers(playerCount);
  const rng = createRng(seed);
  const state = codewordsModule.setup({ players, rng });
  return { state, players, rng };
}

function ctxFor(actor: PlayerId, rng: Rng): ReduceCtx {
  return { actor, rng };
}

/** A clue word guaranteed not to appear on any generated board (not in WORDLIST). */
const SAFE_CLUE_WORD = 'zzzblorptron';

describe('codewords meta', () => {
  it('is a generic, non-trademarked, 4-8 player, 2-team game', () => {
    const { meta } = codewordsModule;
    expect(meta.id).toBe('codewords');
    expect(meta.title.toLowerCase()).not.toContain('codenames');
    expect(meta.minPlayers).toBe(4);
    expect(meta.maxPlayers).toBe(8);
    expect(meta.teams).toEqual({ count: 2, minPerTeam: 2 });
  });
});

describe('setup()', () => {
  it('builds a 25-tile board with the standard 9/8/7/1 colour split, from the original wordlist', () => {
    const { state } = newGame(1);
    expect(state.tiles).toHaveLength(BOARD_SIZE);
    expect(BOARD_SIZE).toBe(GRID_SIZE * GRID_SIZE);

    const counts: Record<string, number> = { team0: 0, team1: 0, neutral: 0, assassin: 0 };
    for (const tile of state.tiles) counts[tile.color] = (counts[tile.color] ?? 0) + 1;

    const startCount = counts[`team${state.turnTeam}`] ?? 0;
    const otherCount = counts[`team${state.turnTeam === 0 ? 1 : 0}`] ?? 0;
    expect(startCount).toBe(STARTING_TEAM_TILES);
    expect(otherCount).toBe(OTHER_TEAM_TILES);
    expect(counts.neutral).toBe(NEUTRAL_TILES);
    expect(counts.assassin).toBe(ASSASSIN_TILES);

    const words = state.tiles.map((t) => t.word);
    expect(new Set(words).size).toBe(BOARD_SIZE); // no duplicate words on one board
    for (const w of words) expect(WORDLIST).toContain(w);

    // ids match the row/col grid scheme the presenter looks tiles up by.
    for (const t of state.tiles) expect(t.id).toBe(`tile-${t.row}-${t.col}`);
  });

  it('assigns every player to exactly one balanced team, each with exactly one spymaster', () => {
    const { state, players } = newGame(2, 6);
    for (const team of [0, 1] as Team[]) {
      const roster = state.teams[team];
      expect([roster.spymaster, ...roster.guessers]).toHaveLength(3);
    }
    for (const p of players) {
      expect([0, 1]).toContain(state.playerTeam[p.id]);
      expect(['spymaster', 'guesser']).toContain(state.playerRole[p.id]);
    }
    // Every player is assigned to exactly one team's roster, no overlaps/gaps.
    const rosterIds = new Set([
      state.teams[0].spymaster,
      ...state.teams[0].guessers,
      state.teams[1].spymaster,
      ...state.teams[1].guessers,
    ]);
    expect(rosterIds).toEqual(new Set(players.map((p) => p.id)));
  });

  it('never calls Math.random — same seed reproduces the same board and team assignment', () => {
    const a = newGame(777, 4).state;
    const b = newGame(777, 4).state;
    expect(a.tiles.map((t) => `${t.id}:${t.word}:${t.color}`)).toEqual(b.tiles.map((t) => `${t.id}:${t.word}:${t.color}`));
    expect(a.teams).toEqual(b.teams);
    expect(a.turnTeam).toBe(b.turnTeam);
  });

  it('rejects an undersized or unbalanced player count (defensive — room-manager.ts already blocks this at the lobby)', () => {
    for (const n of [1, 2, 3, 5, 7]) {
      expect(() => newGame(1, n)).toThrow(IllegalAction);
    }
    for (const n of [4, 6, 8]) {
      expect(() => newGame(1, n)).not.toThrow();
    }
  });
});

describe('currentActors()', () => {
  it('is only the active spymaster during the clue phase', () => {
    const { state } = newGame(3);
    expect(state.phase).toBe('clue');
    expect(codewordsModule.currentActors(state)).toEqual([state.teams[state.turnTeam].spymaster]);
  });

  it('is the active team\'s guessers (not its spymaster) during the guess phase', () => {
    const { state, rng } = newGame(4);
    const spymaster = state.teams[state.turnTeam].spymaster;
    const { state: guessState } = codewordsModule.reduce(
      state,
      { type: 'clue.give', word: SAFE_CLUE_WORD, count: 2 },
      ctxFor(spymaster, rng),
    );
    const actors = codewordsModule.currentActors(guessState);
    expect(actors).toEqual(guessState.teams[guessState.turnTeam].guessers);
    expect(actors).not.toContain(spymaster);
  });

  it('is empty once the game has ended', () => {
    const { state, rng } = newGame(5);
    const assassinTile = state.tiles.find((t) => t.color === 'assassin')!;
    const spymaster = state.teams[state.turnTeam].spymaster;
    const { state: guessState } = codewordsModule.reduce(
      state,
      { type: 'clue.give', word: SAFE_CLUE_WORD, count: 1 },
      ctxFor(spymaster, rng),
    );
    const guesser = guessState.teams[guessState.turnTeam].guessers[0]!;
    const { state: ended } = codewordsModule.reduce(
      guessState,
      { type: 'tile.guess', tileId: assassinTile.id },
      ctxFor(guesser, rng),
    );
    expect(ended.phase).toBe('ended');
    expect(codewordsModule.currentActors(ended)).toEqual([]);
  });
});

describe('clue.give', () => {
  it('only the active spymaster may give a clue', () => {
    const { state, rng } = newGame(6);
    const notSpymaster = Object.keys(state.playerTeam).find((id) => id !== state.teams[state.turnTeam].spymaster)!;
    expect(() =>
      codewordsModule.reduce(state, { type: 'clue.give', word: SAFE_CLUE_WORD, count: 1 }, ctxFor(notSpymaster, rng)),
    ).toThrow(IllegalAction);
  });

  it('rejects a clue count outside 0..9, and a non-single-word clue', () => {
    const { state, rng } = newGame(7);
    const spymaster = state.teams[state.turnTeam].spymaster;
    expect(() =>
      codewordsModule.reduce(state, { type: 'clue.give', word: SAFE_CLUE_WORD, count: -1 }, ctxFor(spymaster, rng)),
    ).toThrow(IllegalAction);
    expect(() =>
      codewordsModule.reduce(state, { type: 'clue.give', word: SAFE_CLUE_WORD, count: 10 }, ctxFor(spymaster, rng)),
    ).toThrow(IllegalAction);
    expect(() =>
      codewordsModule.reduce(state, { type: 'clue.give', word: SAFE_CLUE_WORD, count: 1.5 }, ctxFor(spymaster, rng)),
    ).toThrow(IllegalAction);
    expect(() =>
      codewordsModule.reduce(state, { type: 'clue.give', word: 'two words', count: 1 }, ctxFor(spymaster, rng)),
    ).toThrow(IllegalAction);
  });

  it('rejects a clue that is exactly a word currently on the board', () => {
    const { state, rng } = newGame(8);
    const spymaster = state.teams[state.turnTeam].spymaster;
    const boardWord = state.tiles[0]!.word;
    expect(() =>
      codewordsModule.reduce(state, { type: 'clue.give', word: boardWord, count: 1 }, ctxFor(spymaster, rng)),
    ).toThrow(IllegalAction);
    // case-insensitively too
    expect(() =>
      codewordsModule.reduce(state, { type: 'clue.give', word: boardWord.toUpperCase(), count: 1 }, ctxFor(spymaster, rng)),
    ).toThrow(IllegalAction);
  });

  it('a valid clue moves to the guess phase, sets guessesRemaining = count + 1, and focuses the spymaster\'s seat', () => {
    const { state, rng } = newGame(9);
    const team = state.turnTeam;
    const spymaster = state.teams[team].spymaster;
    const { state: next, events } = codewordsModule.reduce(
      state,
      { type: 'clue.give', word: SAFE_CLUE_WORD, count: 3 },
      ctxFor(spymaster, rng),
    );
    expect(next.phase).toBe('guess');
    expect(next.clue).toEqual({ team, word: SAFE_CLUE_WORD, count: 3 });
    expect(next.guessesRemaining).toBe(4);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('clue.given');
    expect(events[0]!.focus?.target).toEqual({ kind: 'seat', seat: state.playerSeat[spymaster] });
  });

  it('a clue with count 0 is a pass: ends the turn immediately with no guess phase', () => {
    const { state, rng } = newGame(10);
    const team = state.turnTeam;
    const spymaster = state.teams[team].spymaster;
    const { state: next, events } = codewordsModule.reduce(
      state,
      { type: 'clue.give', word: 'pass', count: 0 },
      ctxFor(spymaster, rng),
    );
    expect(next.phase).toBe('clue');
    expect(next.turnTeam).toBe(team === 0 ? 1 : 0);
    expect(next.clue).toBeNull();
    expect(events.map((e) => e.type)).toEqual(['clue.given', 'turn.ended']);
    expect(events[1]!.focus?.target).toEqual({
      kind: 'seat',
      seat: next.playerSeat[next.teams[next.turnTeam].spymaster],
    });
  });
});

/** Drives clue.give then returns the resulting guess-phase state plus one of its guessers. */
function toGuessPhase(state: CodewordsState, rng: Rng, count = 9): { state: CodewordsState; guesser: PlayerId } {
  const spymaster = state.teams[state.turnTeam].spymaster;
  const { state: guessState } = codewordsModule.reduce(
    state,
    { type: 'clue.give', word: SAFE_CLUE_WORD, count },
    ctxFor(spymaster, rng),
  );
  return { state: guessState, guesser: guessState.teams[guessState.turnTeam].guessers[0]! };
}

describe('tile.guess', () => {
  it('only a current guesser on the active team may guess (not the spymaster, not the other team)', () => {
    const { state, rng } = newGame(11);
    const { state: guessState, guesser: _g } = toGuessPhase(state, rng);
    const spymaster = guessState.teams[guessState.turnTeam].spymaster;
    const anyTile = guessState.tiles[0]!;
    expect(() =>
      codewordsModule.reduce(guessState, { type: 'tile.guess', tileId: anyTile.id }, ctxFor(spymaster, rng)),
    ).toThrow(IllegalAction);

    const otherTeamGuesser = guessState.teams[guessState.turnTeam === 0 ? 1 : 0].guessers[0]!;
    expect(() =>
      codewordsModule.reduce(guessState, { type: 'tile.guess', tileId: anyTile.id }, ctxFor(otherTeamGuesser, rng)),
    ).toThrow(IllegalAction);
  });

  it('rejects an unknown or already-revealed tile id', () => {
    const { state, rng } = newGame(12);
    const { state: guessState, guesser } = toGuessPhase(state, rng, 9); // plenty of guesses left
    expect(() =>
      codewordsModule.reduce(guessState, { type: 'tile.guess', tileId: 'tile-9-9' }, ctxFor(guesser, rng)),
    ).toThrow(IllegalAction);

    const team = guessState.turnTeam;
    const ownTile = guessState.tiles.find((t) => t.color === `team${team}`)!;
    const { state: afterGuess } = codewordsModule.reduce(
      guessState,
      { type: 'tile.guess', tileId: ownTile.id },
      ctxFor(guesser, rng),
    );
    // A correct guess with guesses to spare keeps the same team guessing.
    expect(afterGuess.phase).toBe('guess');
    expect(afterGuess.turnTeam).toBe(team);
    expect(() =>
      codewordsModule.reduce(afterGuess, { type: 'tile.guess', tileId: ownTile.id }, ctxFor(guesser, rng)),
    ).toThrow(IllegalAction);
  });

  it('a correct guess with guesses left keeps the guess phase going and emits only tile.revealed', () => {
    const { state, rng } = newGame(13);
    const team = state.turnTeam;
    const { state: guessState, guesser } = toGuessPhase(state, rng, 9); // 10 guesses — comfortably more than 1 needed
    const ownTile = guessState.tiles.find((t) => t.color === `team${team}`)!;
    const { state: next, events } = codewordsModule.reduce(
      guessState,
      { type: 'tile.guess', tileId: ownTile.id },
      ctxFor(guesser, rng),
    );
    expect(next.phase).toBe('guess');
    expect(next.turnTeam).toBe(team);
    expect(next.guessesRemaining).toBe(guessState.guessesRemaining - 1);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('tile.revealed');
    expect(events[0]!.focus?.target).toEqual({ kind: 'object', id: ownTile.id });
    expect(next.tiles.find((t) => t.id === ownTile.id)!.revealed).toBe(true);
  });

  it('running out of guesses ends the turn even after correct guesses', () => {
    const { state, rng } = newGame(14);
    const team = state.turnTeam;
    // The smallest "real" clue is count: 1 (guessesRemaining = count + 1 = 2)
    // — count: 0 is the dedicated pass sentinel (see the clue.give describe
    // block above) and never enters the guess phase at all.
    const { state: guessState, guesser } = toGuessPhase(state, rng, 1);
    expect(guessState.guessesRemaining).toBe(2);
    const ownTiles = guessState.tiles.filter((t) => t.color === `team${team}`);
    // Guard: a real board always has >= 8 tiles for either team, so this always has 2+ to spend.
    expect(ownTiles.length).toBeGreaterThanOrEqual(2);

    const first = codewordsModule.reduce(guessState, { type: 'tile.guess', tileId: ownTiles[0]!.id }, ctxFor(guesser, rng));
    expect(first.state.phase).toBe('guess'); // one guess spent, one left — turn continues
    expect(first.state.guessesRemaining).toBe(1);

    const second = codewordsModule.reduce(first.state, { type: 'tile.guess', tileId: ownTiles[1]!.id }, ctxFor(guesser, rng));
    expect(second.state.phase).toBe('clue');
    expect(second.state.turnTeam).toBe(team === 0 ? 1 : 0);
    expect(second.events.map((e) => e.type)).toEqual(['tile.revealed', 'turn.ended']);
  });

  it('a wrong-colour guess (neutral) ends that team\'s turn immediately', () => {
    const { state, rng } = newGame(15);
    const team = state.turnTeam;
    const { state: guessState, guesser } = toGuessPhase(state, rng);
    const neutralTile = guessState.tiles.find((t) => t.color === 'neutral')!;
    const { state: next, events } = codewordsModule.reduce(
      guessState,
      { type: 'tile.guess', tileId: neutralTile.id },
      ctxFor(guesser, rng),
    );
    expect(next.phase).toBe('clue');
    expect(next.turnTeam).toBe(team === 0 ? 1 : 0);
    expect(events.map((e) => e.type)).toEqual(['tile.revealed', 'turn.ended']);
  });

  it('a wrong-colour guess into the other team\'s tile also ends the turn', () => {
    const { state, rng } = newGame(16);
    const team = state.turnTeam;
    const opposing = team === 0 ? 1 : 0;
    const { state: guessState, guesser } = toGuessPhase(state, rng);
    const opponentTile = guessState.tiles.find((t) => t.color === `team${opposing}`)!;
    const { state: next, events } = codewordsModule.reduce(
      guessState,
      { type: 'tile.guess', tileId: opponentTile.id },
      ctxFor(guesser, rng),
    );
    expect(events[0]!.type).toBe('tile.revealed');
    // Either the turn just ends (clue phase, still 'ended' === null) or, in the
    // rare case this was the opponent's very last hidden tile, they win outright.
    if (next.phase === 'ended') {
      expect(next.winner).toBe(opposing);
      expect(next.endReason).toBe('all-words-found');
    } else {
      expect(next.phase).toBe('clue');
      expect(next.turnTeam).toBe(opposing);
      expect(events.map((e) => e.type)).toEqual(['tile.revealed', 'turn.ended']);
    }
  });

  it('hitting the assassin ends the game immediately as a loss for the guessing team', () => {
    const { state, rng } = newGame(17);
    const team = state.turnTeam;
    const opposing = team === 0 ? 1 : 0;
    const { state: guessState, guesser } = toGuessPhase(state, rng);
    const assassinTile = guessState.tiles.find((t) => t.color === 'assassin')!;
    const { state: next, events } = codewordsModule.reduce(
      guessState,
      { type: 'tile.guess', tileId: assassinTile.id },
      ctxFor(guesser, rng),
    );
    expect(next.phase).toBe('ended');
    expect(next.winner).toBe(opposing);
    expect(next.endReason).toBe('assassin');
    expect(events.map((e) => e.type)).toEqual(['tile.revealed', 'assassin.hit']);
    const assassinEvent = events[1]!;
    expect(assassinEvent.focus?.target).toEqual({ kind: 'object', id: assassinTile.id });
    expect(assassinEvent.focus?.holdMs).toBeGreaterThanOrEqual(3000);
    expect(assassinEvent.focus?.priority).toBe('high');
    expect(codewordsModule.currentActors(next)).toEqual([]);
    expect(codewordsModule.isTerminal(next)).not.toBeNull();
  });

  it('finding every one of a team\'s tiles wins the game outright, mid-guess-phase', () => {
    const { state, rng } = newGame(18);
    const team = state.turnTeam;
    let guessState = toGuessPhase(state, rng, 9).state;
    let remaining = guessState.tiles.filter((t) => t.color === `team${team}` && !t.revealed);
    let lastEvents: ReturnType<typeof codewordsModule.reduce>['events'] = [];
    let iterations = 0;
    while (remaining.length > 0 && iterations < STARTING_TEAM_TILES + 2) {
      iterations += 1;
      const guesser = guessState.teams[guessState.turnTeam].guessers[0]!;
      const tile = remaining[0]!;
      const result = codewordsModule.reduce(guessState, { type: 'tile.guess', tileId: tile.id }, ctxFor(guesser, rng));
      guessState = result.state;
      lastEvents = result.events;
      if (guessState.phase === 'ended') break;
      remaining = guessState.tiles.filter((t) => t.color === `team${team}` && !t.revealed);
    }
    expect(guessState.phase).toBe('ended');
    expect(guessState.winner).toBe(team);
    expect(guessState.endReason).toBe('all-words-found');
    expect(lastEvents.map((e) => e.type)).toEqual(['tile.revealed']);
    const result = codewordsModule.isTerminal(guessState);
    expect(result).not.toBeNull();
    expect(new Set(result!.winners)).toEqual(new Set([guessState.teams[team].spymaster, ...guessState.teams[team].guessers]));
  });
});

describe('turn.pass', () => {
  it('a guesser may voluntarily end the turn', () => {
    const { state, rng } = newGame(19);
    const team = state.turnTeam;
    const { state: guessState, guesser } = toGuessPhase(state, rng);
    const { state: next, events } = codewordsModule.reduce(guessState, { type: 'turn.pass' }, ctxFor(guesser, rng));
    expect(next.phase).toBe('clue');
    expect(next.turnTeam).toBe(team === 0 ? 1 : 0);
    expect(events.map((e) => e.type)).toEqual(['turn.ended']);
  });

  it('the spymaster may not pass, and passing outside the guess phase is illegal', () => {
    const { state, rng } = newGame(20);
    const spymaster = state.teams[state.turnTeam].spymaster;
    expect(() => codewordsModule.reduce(state, { type: 'turn.pass' }, ctxFor(spymaster, rng))).toThrow(IllegalAction);

    const { state: guessState } = toGuessPhase(state, rng);
    const guessSpymaster = guessState.teams[guessState.turnTeam].spymaster;
    expect(() => codewordsModule.reduce(guessState, { type: 'turn.pass' }, ctxFor(guessSpymaster, rng))).toThrow(
      IllegalAction,
    );
  });
});

describe('defaultAction()', () => {
  it("plays a count-0 pass clue for a disconnected spymaster", () => {
    const { state } = newGame(21);
    const spymaster = state.teams[state.turnTeam].spymaster;
    expect(codewordsModule.defaultAction(state, spymaster)).toEqual({ type: 'clue.give', word: 'pass', count: 0 });
  });

  it('plays turn.pass for a disconnected guesser', () => {
    const { state, rng } = newGame(22);
    const { state: guessState, guesser } = toGuessPhase(state, rng);
    expect(codewordsModule.defaultAction(guessState, guesser)).toEqual({ type: 'turn.pass' });
  });

  it('throws for a player who is not currently an actor', () => {
    const { state } = newGame(23);
    const notSpymaster = Object.keys(state.playerTeam).find((id) => id !== state.teams[state.turnTeam].spymaster)!;
    expect(() => codewordsModule.defaultAction(state, notSpymaster)).toThrow(IllegalAction);
  });
});

describe('reduce() input hygiene', () => {
  it('throws on a malformed action and on any action once the game has ended', () => {
    const { state, rng } = newGame(24);
    const spymaster = state.teams[state.turnTeam].spymaster;
    // These are deliberately outside CodewordsAction's type — exercising the
    // runtime guard reduce() must apply to whatever actually arrives over
    // the wire (module.ts's real signature is `action: unknown`; the
    // registry that game-host.ts calls through is untyped GameModule<any,
    // any, any> — see packages/engine/src/registry.ts).
    expect(() => codewordsModule.reduce(state, { nope: true } as never, ctxFor(spymaster, rng))).toThrow(IllegalAction);
    expect(() => codewordsModule.reduce(state, null as never, ctxFor(spymaster, rng))).toThrow(IllegalAction);
    expect(() => codewordsModule.reduce(state, { type: 'not.a.real.action' } as never, ctxFor(spymaster, rng))).toThrow(
      IllegalAction,
    );

    const { state: guessState, guesser } = toGuessPhase(state, rng);
    const assassinTile = guessState.tiles.find((t) => t.color === 'assassin')!;
    const { state: ended } = codewordsModule.reduce(
      guessState,
      { type: 'tile.guess', tileId: assassinTile.id },
      ctxFor(guesser, rng),
    );
    expect(ended.phase).toBe('ended');
    expect(() => codewordsModule.reduce(ended, { type: 'turn.pass' }, ctxFor(guesser, rng))).toThrow(IllegalAction);
  });
});
