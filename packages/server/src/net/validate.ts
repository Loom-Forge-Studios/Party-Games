import type { ClientMessage } from '@party/protocol';

/**
 * Shape validation for inbound wire traffic. `ClientMessage` (from
 * `@party/protocol`) is frozen and describes the *intended* shapes, but a
 * socket can send us anything — this is the boundary that turns "arbitrary
 * bytes a client sent us" into "a ClientMessage we're willing to act on, or
 * nothing at all". Unknown `t`, wrong field types, and missing required
 * fields are all rejected (return null) rather than guessed at.
 *
 * Deliberately not exhaustive on *extra* fields — an unrecognised extra
 * property on an otherwise-valid message is ignored, not rejected, so a
 * slightly-ahead client doesn't get hard-rejected. What is never trusted is
 * the *type* and *presence* of every field the server actually reads.
 */

const MAX_USERNAME_LENGTH = 24;
const MAX_CHAT_LENGTH = 500;
/** Room ids are always ROOM_ID_LENGTH chars from a known alphabet (see
 * @party/protocol ids.ts), but that generator-side constant isn't a
 * validator; bound the length generously instead of hard-coding "4". */
const MAX_ROOM_ID_LENGTH = 16;
const MAX_GAME_ID_LENGTH = 64;

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Parses and validates a raw inbound frame. Returns the typed
 * `ClientMessage` on success, or null if the frame is malformed JSON, not an
 * object, has an unrecognised `t`, or is missing/mistypes a required field.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateClientMessage(parsed);
}

export function validateClientMessage(msg: unknown): ClientMessage | null {
  if (!isPlainObject(msg)) return null;
  const t = msg['t'];
  if (typeof t !== 'string') return null;

  switch (t) {
    case 'hello': {
      if (!isNonEmptyString(msg['username'], MAX_USERNAME_LENGTH)) return null;
      if ('resumeToken' in msg && msg['resumeToken'] !== undefined && typeof msg['resumeToken'] !== 'string') {
        return null;
      }
      const resumeToken = typeof msg['resumeToken'] === 'string' ? msg['resumeToken'] : undefined;
      return resumeToken === undefined
        ? { t: 'hello', username: msg['username'] as string }
        : { t: 'hello', username: msg['username'] as string, resumeToken };
    }
    case 'room.create': {
      if (!isNonEmptyString(msg['gameId'], MAX_GAME_ID_LENGTH)) return null;
      if (!isPositiveInt(msg['maxPlayers'])) return null;
      return { t: 'room.create', gameId: msg['gameId'] as string, maxPlayers: msg['maxPlayers'] as number };
    }
    case 'room.join': {
      if (!isNonEmptyString(msg['roomId'], MAX_ROOM_ID_LENGTH)) return null;
      return { t: 'room.join', roomId: msg['roomId'] as string };
    }
    case 'room.leave':
      return { t: 'room.leave' };
    case 'room.kick': {
      if (!isNonEmptyString(msg['target'], 128)) return null;
      return { t: 'room.kick', target: msg['target'] as string };
    }
    case 'room.config': {
      const hasGameId = 'gameId' in msg && msg['gameId'] !== undefined;
      const hasMaxPlayers = 'maxPlayers' in msg && msg['maxPlayers'] !== undefined;
      if (hasGameId && !isNonEmptyString(msg['gameId'], MAX_GAME_ID_LENGTH)) return null;
      if (hasMaxPlayers && !isPositiveInt(msg['maxPlayers'])) return null;
      return {
        t: 'room.config',
        ...(hasGameId ? { gameId: msg['gameId'] as string } : {}),
        ...(hasMaxPlayers ? { maxPlayers: msg['maxPlayers'] as number } : {}),
      };
    }
    case 'room.start':
      return { t: 'room.start' };
    case 'game.action': {
      if (!('action' in msg)) return null;
      return { t: 'game.action', action: msg['action'] };
    }
    case 'chat': {
      if (!isNonEmptyString(msg['text'], MAX_CHAT_LENGTH)) return null;
      return { t: 'chat', text: msg['text'] as string };
    }
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}
