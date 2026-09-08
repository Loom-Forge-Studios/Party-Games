// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { FALLBACK_GAMES } from '../../app/games.js';
import { renderMenuScreen } from './menuScreen.js';

describe('renderMenuScreen', () => {
  it('creates a room with the selected game and player count', () => {
    const onCreate = vi.fn();
    const el = renderMenuScreen({ username: 'alice', games: FALLBACK_GAMES, onCreate, onJoin: vi.fn() });

    const gameSelect = el.querySelector<HTMLSelectElement>('[data-testid="create-game-select"]')!;
    gameSelect.value = 'holdem';
    gameSelect.dispatchEvent(new Event('change'));

    const maxPlayersSelect = el.querySelector<HTMLSelectElement>('[data-testid="create-max-players-select"]')!;
    maxPlayersSelect.value = '4';

    el.querySelector('[data-testid="create-room-form"]')!.dispatchEvent(new Event('submit'));

    expect(onCreate).toHaveBeenCalledWith('holdem', 4);
  });

  it('joins a room by the entered code', () => {
    const onJoin = vi.fn();
    const el = renderMenuScreen({ username: 'alice', games: FALLBACK_GAMES, onCreate: vi.fn(), onJoin });

    const input = el.querySelector<HTMLInputElement>('[data-testid="join-code-input"]')!;
    input.value = 'abcd';
    el.querySelector('[data-testid="join-room-form"]')!.dispatchEvent(new Event('submit'));

    expect(onJoin).toHaveBeenCalledWith('ABCD');
  });

  it('re-narrows the player-count options when the game selection changes', () => {
    const el = renderMenuScreen({ username: 'alice', games: FALLBACK_GAMES, onCreate: vi.fn(), onJoin: vi.fn() });
    const gameSelect = el.querySelector<HTMLSelectElement>('[data-testid="create-game-select"]')!;
    const maxPlayersSelect = el.querySelector<HTMLSelectElement>('[data-testid="create-max-players-select"]')!;

    gameSelect.value = 'checkers'; // min 2, max 2
    gameSelect.dispatchEvent(new Event('change'));
    expect(Array.from(maxPlayersSelect.options).map((o) => o.value)).toEqual(['2']);

    gameSelect.value = 'codewords'; // min 4, max 8
    gameSelect.dispatchEvent(new Event('change'));
    expect(Array.from(maxPlayersSelect.options).map((o) => o.value)).toEqual(['4', '5', '6', '7', '8']);
  });
});
