import { describe, it, expect } from 'vitest';
import { parseClientMessage, validateClientMessage } from './validate.js';

describe('validateClientMessage', () => {
  it('accepts every valid ClientMessage shape', () => {
    expect(validateClientMessage({ t: 'hello', username: 'alice' })).toEqual({ t: 'hello', username: 'alice' });
    expect(validateClientMessage({ t: 'hello', username: 'alice', resumeToken: 'tok' })).toEqual({
      t: 'hello',
      username: 'alice',
      resumeToken: 'tok',
    });
    expect(validateClientMessage({ t: 'room.create', gameId: 'checkers', maxPlayers: 2 })).toEqual({
      t: 'room.create',
      gameId: 'checkers',
      maxPlayers: 2,
    });
    expect(validateClientMessage({ t: 'room.join', roomId: 'ABCD' })).toEqual({ t: 'room.join', roomId: 'ABCD' });
    expect(validateClientMessage({ t: 'room.leave' })).toEqual({ t: 'room.leave' });
    expect(validateClientMessage({ t: 'room.kick', target: 'p1' })).toEqual({ t: 'room.kick', target: 'p1' });
    expect(validateClientMessage({ t: 'room.config', gameId: 'holdem' })).toEqual({
      t: 'room.config',
      gameId: 'holdem',
    });
    expect(validateClientMessage({ t: 'room.config', maxPlayers: 4 })).toEqual({ t: 'room.config', maxPlayers: 4 });
    expect(validateClientMessage({ t: 'room.config' })).toEqual({ t: 'room.config' });
    expect(validateClientMessage({ t: 'room.start' })).toEqual({ t: 'room.start' });
    expect(validateClientMessage({ t: 'game.action', action: { move: 'e4' } })).toEqual({
      t: 'game.action',
      action: { move: 'e4' },
    });
    expect(validateClientMessage({ t: 'game.action', action: null })).toEqual({ t: 'game.action', action: null });
    expect(validateClientMessage({ t: 'chat', text: 'hi' })).toEqual({ t: 'chat', text: 'hi' });
    expect(validateClientMessage({ t: 'ping' })).toEqual({ t: 'ping' });
  });

  it('ignores unrecognised extra fields on an otherwise-valid message', () => {
    expect(validateClientMessage({ t: 'ping', extra: 'field', another: 123 })).toEqual({ t: 'ping' });
  });

  it('rejects non-object input', () => {
    expect(validateClientMessage(null)).toBeNull();
    expect(validateClientMessage(undefined)).toBeNull();
    expect(validateClientMessage('hello')).toBeNull();
    expect(validateClientMessage(42)).toBeNull();
    expect(validateClientMessage([1, 2, 3])).toBeNull();
    expect(validateClientMessage(true)).toBeNull();
  });

  it('rejects a missing or unrecognised t', () => {
    expect(validateClientMessage({})).toBeNull();
    expect(validateClientMessage({ t: 'not.a.real.type' })).toBeNull();
    expect(validateClientMessage({ t: 123 })).toBeNull();
    // Prototype-pollution-flavoured keys must not be treated specially.
    expect(validateClientMessage({ t: '__proto__' })).toBeNull();
  });

  it('rejects wrong-typed or missing required fields per message type', () => {
    expect(validateClientMessage({ t: 'hello' })).toBeNull(); // missing username
    expect(validateClientMessage({ t: 'hello', username: 42 })).toBeNull();
    expect(validateClientMessage({ t: 'hello', username: '' })).toBeNull();
    expect(validateClientMessage({ t: 'hello', username: '   ' })).toBeNull();
    expect(validateClientMessage({ t: 'hello', username: 'a'.repeat(25) })).toBeNull(); // too long
    expect(validateClientMessage({ t: 'hello', username: 'alice', resumeToken: 42 })).toBeNull();

    expect(validateClientMessage({ t: 'room.create', gameId: 'checkers' })).toBeNull(); // missing maxPlayers
    expect(validateClientMessage({ t: 'room.create', gameId: 'checkers', maxPlayers: 0 })).toBeNull();
    expect(validateClientMessage({ t: 'room.create', gameId: 'checkers', maxPlayers: -1 })).toBeNull();
    expect(validateClientMessage({ t: 'room.create', gameId: 'checkers', maxPlayers: 2.5 })).toBeNull();
    expect(validateClientMessage({ t: 'room.create', gameId: 'checkers', maxPlayers: '2' })).toBeNull();

    expect(validateClientMessage({ t: 'room.join', roomId: '' })).toBeNull();
    expect(validateClientMessage({ t: 'room.join' })).toBeNull();

    expect(validateClientMessage({ t: 'room.kick' })).toBeNull();
    expect(validateClientMessage({ t: 'room.kick', target: 5 })).toBeNull();

    expect(validateClientMessage({ t: 'room.config', maxPlayers: 0 })).toBeNull();
    expect(validateClientMessage({ t: 'room.config', gameId: '' })).toBeNull();

    expect(validateClientMessage({ t: 'game.action' })).toBeNull(); // missing action key entirely

    expect(validateClientMessage({ t: 'chat' })).toBeNull();
    expect(validateClientMessage({ t: 'chat', text: '' })).toBeNull();
    expect(validateClientMessage({ t: 'chat', text: 'x'.repeat(501) })).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it('parses valid JSON into a validated ClientMessage', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'ping' }))).toEqual({ t: 'ping' });
  });

  it('returns null on malformed JSON instead of throwing', () => {
    expect(parseClientMessage('{not valid json')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
    expect(parseClientMessage('undefined')).toBeNull();
  });

  it('returns null when the parsed JSON is valid but not a ClientMessage', () => {
    expect(parseClientMessage(JSON.stringify([1, 2, 3]))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });
});
