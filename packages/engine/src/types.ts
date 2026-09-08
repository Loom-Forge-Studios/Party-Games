import type { GameId, PlayerId, PlayerPublic, GameEvent, GameResult } from '@party/protocol';
import type { Rng } from './rng.js';

export interface GameMeta {
  id: GameId;
  title: string; // generic, non-trademarked
  minPlayers: number;
  maxPlayers: number;
  teams?: { count: number; minPerTeam: number };
  estMinutes?: number;
  summary: string;
}

export interface SetupCtx {
  players: PlayerPublic[];
  rng: Rng;
  options?: unknown;
}

export interface ReduceCtx {
  actor: PlayerId;
  rng: Rng;
}

export interface ReduceResult<S> {
  state: S;
  events: GameEvent[];
}

export interface GameModule<S = unknown, A = unknown, V = unknown> {
  meta: GameMeta;
  setup(ctx: SetupCtx): S;
  /** Throws IllegalAction on invalid input. Must be pure and deterministic given rng. */
  reduce(state: S, action: A, ctx: ReduceCtx): ReduceResult<S>;
  /** MUST strip everything viewer is not entitled to see. Enforced by test. */
  view(state: S, viewer: PlayerId): V;
  currentActors(state: S): PlayerId[];
  isTerminal(state: S): GameResult | null;
  /** Played on behalf of a disconnected/timed-out player. */
  defaultAction(state: S, player: PlayerId): A;
}
