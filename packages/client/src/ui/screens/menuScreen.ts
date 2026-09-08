import type { GameId, RoomId } from '@party/protocol';
import { ROOM_ID_LENGTH } from '@party/protocol';
import type { GameListEntry } from '../../app/games.js';
import { el } from '../dom.js';

export interface MenuScreenProps {
  username: string;
  games: readonly GameListEntry[];
  error?: string | null;
  onCreate: (gameId: GameId, maxPlayers: number) => void;
  onJoin: (roomId: RoomId) => void;
}

/** Second screen: create a room (pick a game + player count) or join one by code. */
export function renderMenuScreen(props: MenuScreenProps): HTMLElement {
  const firstGame = props.games[0];

  const gameSelect = el(
    'select',
    { id: 'pg-create-game', 'data-testid': 'create-game-select' },
    props.games.map((game) =>
      el('option', { value: game.id }, [`${game.title} (${formatPlayerRange(game)})`]),
    ),
  );

  const maxPlayersSelect = el('select', { id: 'pg-create-max-players', 'data-testid': 'create-max-players-select' });
  const syncMaxPlayersOptions = () => {
    const game = props.games.find((g) => g.id === gameSelect.value) ?? firstGame;
    const options = game ? playerCountOptions(game.minPlayers, game.maxPlayers) : [2, 3, 4];
    maxPlayersSelect.replaceChildren(...options.map((n) => el('option', { value: n }, [String(n)])));
  };
  syncMaxPlayersOptions();
  gameSelect.addEventListener('change', syncMaxPlayersOptions);

  const createForm = el(
    'form',
    {
      class: 'pg-panel',
      'data-testid': 'create-room-form',
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        const gameId = gameSelect.value as GameId;
        const maxPlayers = Number(maxPlayersSelect.value);
        if (!gameId || !Number.isFinite(maxPlayers)) return;
        props.onCreate(gameId, maxPlayers);
      },
    },
    [
      el('h2', {}, ['Create a room']),
      el('label', { for: 'pg-create-game' }, ['Game']),
      gameSelect,
      el('label', { for: 'pg-create-max-players' }, ['Players']),
      maxPlayersSelect,
      el('button', { type: 'submit', class: 'pg-button pg-button--primary', 'data-testid': 'create-room-submit' }, [
        'Create room',
      ]),
    ],
  );

  const joinInput = el('input', {
    id: 'pg-join-code',
    type: 'text',
    inputmode: 'text',
    autocapitalize: 'characters',
    maxlength: ROOM_ID_LENGTH,
    placeholder: 'CODE',
    'data-testid': 'join-code-input',
  });

  const joinForm = el(
    'form',
    {
      class: 'pg-panel',
      'data-testid': 'join-room-form',
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        const roomId = joinInput.value.trim().toUpperCase();
        if (roomId.length === 0) return;
        props.onJoin(roomId);
      },
    },
    [
      el('h2', {}, ['Join a room']),
      el('label', { for: 'pg-join-code' }, ['Room code']),
      joinInput,
      el('button', { type: 'submit', class: 'pg-button pg-button--primary', 'data-testid': 'join-room-submit' }, [
        'Join room',
      ]),
    ],
  );

  return el('div', { class: 'pg-screen pg-menu-screen', 'data-testid': 'menu-screen' }, [
    el('h1', {}, [`Hi, ${props.username}`]),
    props.error ? el('p', { class: 'pg-error', role: 'alert', 'data-testid': 'menu-error' }, [props.error]) : null,
    createForm,
    joinForm,
  ]);
}

function formatPlayerRange(game: GameListEntry): string {
  return game.minPlayers === game.maxPlayers ? `${game.minPlayers}p` : `${game.minPlayers}-${game.maxPlayers}p`;
}

function playerCountOptions(min: number, max: number): number[] {
  const options: number[] = [];
  for (let n = min; n <= max; n++) options.push(n);
  return options.length > 0 ? options : [min];
}
