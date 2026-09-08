// Meta sanity guard: cheap, static checks on a GameMeta that catch a typo
// or copy-paste mistake before it ever reaches a lobby's Start button.
//
// - minPlayers <= maxPlayers.
// - if meta.teams is set: minPerTeam is a positive integer, teams.count is
//   a positive integer, and minPerTeam doesn't exceed what the game's own
//   minPlayers could actually field per team (floor(minPlayers / count)) —
//   i.e. a game cannot simultaneously claim it's startable with as few as
//   `minPlayers` players while also requiring more players per team than
//   that minimum could ever supply.
import type { GameMeta } from '../types.js';

export class MetaSanityError extends Error {}

export function assertMetaSanity(meta: GameMeta): void {
  if (!Number.isInteger(meta.minPlayers) || !Number.isInteger(meta.maxPlayers)) {
    throw new MetaSanityError(
      `meta-sanity: game "${meta.id}" has non-integer minPlayers/maxPlayers (${meta.minPlayers}/${meta.maxPlayers})`,
    );
  }
  if (meta.minPlayers > meta.maxPlayers) {
    throw new MetaSanityError(`meta-sanity: game "${meta.id}" has minPlayers (${meta.minPlayers}) > maxPlayers (${meta.maxPlayers})`);
  }

  if (!meta.teams) return;
  const { count, minPerTeam } = meta.teams;

  if (!Number.isInteger(count) || count <= 0) {
    throw new MetaSanityError(`meta-sanity: game "${meta.id}" declares meta.teams.count=${count}, which is not a positive integer`);
  }
  if (!Number.isInteger(minPerTeam) || minPerTeam <= 0) {
    throw new MetaSanityError(`meta-sanity: game "${meta.id}" declares meta.teams.minPerTeam=${minPerTeam}, which is not a positive integer`);
  }

  const maxFieldableFromMinPlayers = Math.floor(meta.minPlayers / count);
  if (minPerTeam > maxFieldableFromMinPlayers) {
    throw new MetaSanityError(
      `meta-sanity: game "${meta.id}" declares meta.teams.minPerTeam=${minPerTeam} across ${count} teams, but its own ` +
        `minPlayers=${meta.minPlayers} could field at most ${maxFieldableFromMinPlayers} per team — a room could reach "startable" ` +
        `with fewer players on a team than this game itself requires.`,
    );
  }
}
