// State/action/view shapes for the Hold'em GameModule. Kept separate from
// module.ts so evaluator/pots tests and the module tests can share types
// without pulling in the reduce() logic.

import type { PlayerId } from '@party/protocol';
import type { Card } from './deck.js';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'handOver' | 'gameOver';

export interface HoldemPlayerState {
  id: PlayerId;
  seat: number;
  stack: number;
  /** Server truth only — never copied into a view for anyone but the owning player. */
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  committedRound: number;
  committedTotal: number;
  hasActedThisRound: boolean;
  /** Dealt into the *current* hand (false for players who busted before it started). */
  inHand: boolean;
  /** Busted out of the whole game (stack hit 0 and they were forced to fold or lost a showdown). */
  eliminated: boolean;
}

export interface ShowdownReveal {
  playerId: PlayerId;
  seat: number;
  holeCards: Card[];
  categoryLabel: string;
}

export interface PotAward {
  playerId: PlayerId;
  seat: number;
  amount: number;
}

export interface HoldemState {
  players: HoldemPlayerState[];
  deck: Card[];
  community: Card[];
  street: Street;
  dealerSeat: number;
  smallBlindAmt: number;
  bigBlindAmt: number;
  /** Highest committedRound among active players this street. */
  currentBet: number;
  /** Minimum legal size of the next raise's increment over currentBet. */
  minRaiseSize: number;
  actingSeat: number | null;
  handNumber: number;
  lastShowdown: ShowdownReveal[] | null;
  lastAwards: PotAward[] | null;
  winnerPlayerId: PlayerId | null;
}

export type HoldemAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** amount = the total they want committedRound to become (i.e. "bet to X"). */
  | { type: 'bet'; amount: number }
  /** amount = the total they want committedRound to become (i.e. "raise to X"), not the increment. */
  | { type: 'raise'; amount: number }
  | { type: 'allin' };

export interface HoldemPublicPlayerView {
  id: PlayerId;
  seat: number;
  stack: number;
  committedRound: number;
  committedTotal: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  eliminated: boolean;
  /** 0 or 2 — lets the client render face-down backs without ever seeing the cards. */
  holeCardCount: number;
}

export interface HoldemView {
  street: Street;
  dealerSeat: number;
  smallBlindAmt: number;
  bigBlindAmt: number;
  community: Card[];
  pot: number;
  currentBet: number;
  minRaiseSize: number;
  actingSeat: number | null;
  players: HoldemPublicPlayerView[];
  /** The viewer's own hole cards, present only when the viewer is seated and holds cards. Never any other player's. */
  you: { id: PlayerId; seat: number; holeCards: Card[] } | null;
  /** Public once a hand reaches showdown — only players who didn't fold are ever included. */
  lastShowdown: ShowdownReveal[] | null;
  lastAwards: PotAward[] | null;
  handNumber: number;
  winnerPlayerId: PlayerId | null;
}
