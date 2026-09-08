import type { GameId, PlayerId, PlayerPublic, RoomState } from '@party/protocol';
import type { GameListEntry } from '../../app/games.js';
import { el } from '../dom.js';

export interface LobbyScreenProps {
  room: RoomState;
  localPlayerId: PlayerId;
  games: readonly GameListEntry[];
  onKick: (target: PlayerId) => void;
  onSelectGame: (gameId: GameId) => void;
  onSetMaxPlayers: (maxPlayers: number) => void;
  onStart: () => void;
  onLeave: () => void;
}

/**
 * Lobby screen. Every bit of this render is derived straight from
 * `props.room` on each call — no local "am I the host" boolean, no cached
 * copy of the player list. Re-render on every `room.state` message and the
 * DOM always matches the server's `RoomState` (DoD: "UI driven entirely by
 * RoomState").
 */
export function renderLobbyScreen(props: LobbyScreenProps): HTMLElement {
  const { room, localPlayerId } = props;
  const self = room.players.find((p) => p.id === localPlayerId);
  const isHost = self?.isHost ?? false;

  const children = [
    el('h1', {}, ['Lobby']),
    el('div', { class: 'pg-panel' }, [
      el('span', {}, ['Room code']),
      el('div', { class: 'pg-room-code', 'data-testid': 'room-code' }, [room.id]),
    ]),
    renderPlayerList(room, isHost, props.onKick),
    renderGameConfig(room, isHost, props.games, props.onSelectGame, props.onSetMaxPlayers),
    renderStartControls(room, isHost, props.onStart),
    el(
      'button',
      { type: 'button', class: 'pg-button', 'data-testid': 'leave-room-button', onclick: () => props.onLeave() },
      ['Leave room'],
    ),
  ];

  return el('div', { class: 'pg-screen pg-lobby-screen', 'data-testid': 'lobby-screen' }, children);
}

function renderPlayerList(room: RoomState, isHost: boolean, onKick: (target: PlayerId) => void): HTMLElement {
  const rows = room.players.map((player) => renderPlayerRow(player, isHost, onKick));
  return el('div', { class: 'pg-panel' }, [
    el('h2', {}, [`Players (${room.players.length}/${room.maxPlayers})`]),
    el('ul', { class: 'pg-player-list', 'data-testid': 'player-list' }, rows),
  ]);
}

function renderPlayerRow(player: PlayerPublic, isHost: boolean, onKick: (target: PlayerId) => void): HTMLElement {
  const kickButton =
    isHost && !player.isHost
      ? el(
          'button',
          {
            type: 'button',
            class: 'pg-button pg-button--danger',
            'data-testid': `kick-button-${player.id}`,
            'aria-label': `Kick ${player.username}`,
            onclick: () => onKick(player.id),
          },
          ['Kick'],
        )
      : null;

  return el(
    'li',
    { class: 'pg-player-row', 'data-testid': `player-row-${player.id}`, 'data-connected': String(player.connected) },
    [
      el('span', { class: 'pg-player-name' }, [player.username]),
      el('span', { class: 'pg-badge' }, [`Seat ${player.seat}`]),
      player.isHost ? el('span', { class: 'pg-badge pg-badge--host', 'data-testid': `host-badge-${player.id}` }, ['Host']) : null,
      !player.connected ? el('span', { class: 'pg-badge' }, ['Disconnected']) : null,
      kickButton,
    ],
  );
}

function renderGameConfig(
  room: RoomState,
  isHost: boolean,
  games: readonly GameListEntry[],
  onSelectGame: (gameId: GameId) => void,
  onSetMaxPlayers: (maxPlayers: number) => void,
): HTMLElement {
  const selectedGame = games.find((g) => g.id === room.gameId);

  if (!isHost) {
    return el('div', { class: 'pg-panel', 'data-testid': 'game-config-readonly' }, [
      el('h2', {}, ['Game']),
      el('p', { class: 'pg-hint' }, [selectedGame ? `${selectedGame.title}, max ${room.maxPlayers} players` : 'Waiting for the host to choose a game']),
    ]);
  }

  const gameSelect = el(
    'select',
    {
      id: 'pg-lobby-game',
      'data-testid': 'game-select',
      onchange: (ev: Event) => onSelectGame((ev.target as HTMLSelectElement).value as GameId),
    },
    games.map((game) =>
      el('option', { value: game.id, selected: game.id === room.gameId }, [game.title]),
    ),
  );

  const maxPlayersOptions = selectedGame ? playerCountOptions(selectedGame.minPlayers, selectedGame.maxPlayers) : [room.maxPlayers];
  const maxPlayersSelect = el(
    'select',
    {
      id: 'pg-lobby-max-players',
      'data-testid': 'max-players-select',
      onchange: (ev: Event) => onSetMaxPlayers(Number((ev.target as HTMLSelectElement).value)),
    },
    maxPlayersOptions.map((n) => el('option', { value: n, selected: n === room.maxPlayers }, [String(n)])),
  );

  return el('div', { class: 'pg-panel', 'data-testid': 'game-config-host' }, [
    el('h2', {}, ['Game']),
    el('label', { for: 'pg-lobby-game' }, ['Game']),
    gameSelect,
    el('label', { for: 'pg-lobby-max-players' }, ['Players']),
    maxPlayersSelect,
  ]);
}

function renderStartControls(room: RoomState, isHost: boolean, onStart: () => void): HTMLElement {
  if (!isHost) {
    return el('p', { class: 'pg-hint', role: 'status', 'data-testid': 'start-waiting-hint' }, [
      room.startable.reason ? `Waiting for the host to start — ${room.startable.reason}` : 'Waiting for the host to start',
    ]);
  }

  const disabled = !room.startable.ok;
  return el('div', { class: 'pg-row' }, [
    el(
      'button',
      {
        type: 'button',
        class: 'pg-button pg-button--primary',
        'data-testid': 'start-button',
        disabled,
        title: room.startable.reason ?? '',
        'aria-disabled': String(disabled),
        onclick: () => {
          if (!disabled) onStart();
        },
      },
      ['Start game'],
    ),
    disabled && room.startable.reason
      ? el('p', { class: 'pg-hint', role: 'status', 'data-testid': 'start-disabled-reason' }, [room.startable.reason])
      : null,
  ]);
}

function playerCountOptions(min: number, max: number): number[] {
  const options: number[] = [];
  for (let n = min; n <= max; n++) options.push(n);
  return options.length > 0 ? options : [min];
}
