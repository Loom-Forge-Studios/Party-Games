import type { PlayerId } from './ids.js';

/**
 * NOTE ON PACKAGE LAYOUT: GameEvent, FocusHint, FocusTarget and GameResult are
 * defined here (in @party/protocol) rather than in @party/engine, even though
 * the A0 spec's §B code block lists them alongside the engine contracts. They
 * are defined here because ServerMessage (below, in messages.ts) needs them
 * and protocol must have zero dependency on engine to avoid a circular
 * package reference (engine already depends on protocol for
 * PlayerId/PlayerPublic/GameId). @party/engine re-exports all four from its
 * own index.ts so `import { GameEvent } from '@party/engine'` still works for
 * game-module authors. See docs/ARCHITECTURE.md for the full rationale.
 */

export type FocusTarget =
  | { kind: 'point'; x: number; y: number; z: number }
  | { kind: 'object'; id: string } // scene object id owned by the presenter
  | { kind: 'seat'; seat: number }
  | { kind: 'table' }; // wide establishing shot

export interface FocusHint {
  target: FocusTarget;
  holdMs?: number; // dwell time; director may clamp
  priority?: 'low' | 'normal' | 'high';
}

export interface GameEvent {
  type: string; // game-defined, e.g. 'piece.moved'
  payload: unknown;
  focus?: FocusHint;
  actor?: PlayerId;
  private?: PlayerId[]; // if set, ONLY these players receive it
}

export interface GameResult {
  winners: PlayerId[];
  scores?: Record<PlayerId, number>;
  reason: string;
}
