// Card representation, deck construction, and asset-key mapping for Hold'em.
//
// Rank is stored numerically (2..14, ace = 14 = high) so evaluator.ts can do
// straight/wheel arithmetic directly; rankDisplay() converts to the string
// form the assets package expects ('2'..'10','J','Q','K','A').

export type Suit = 'S' | 'H' | 'D' | 'C';

export interface Card {
  /** 2..14, where 14 = Ace (ace-high by default; the wheel straight is a
   *  special case handled in evaluator.ts, not by re-ranking the card). */
  rank: number;
  suit: Suit;
}

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** A fresh, unshuffled 52-card deck. Callers must shuffle via ctx.rng — never Math.random(). */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/** Rank as the display string used in card/<RANK><SUIT> asset keys and UI labels. */
export function rankDisplay(rank: number): string {
  switch (rank) {
    case 14:
      return 'A';
    case 13:
      return 'K';
    case 12:
      return 'Q';
    case 11:
      return 'J';
    default:
      return String(rank);
  }
}

/** `card/<RANK><SUIT>` — matches packages/assets' PlaceholderAssetLoader key scheme exactly. */
export function cardAssetKey(card: Card): string {
  return `card/${rankDisplay(card.rank)}${card.suit}`;
}

/** Stable short id for equality/dedup/testing, e.g. "14S" for the ace of spades. */
export function cardId(card: Card): string {
  return `${card.rank}${card.suit}`;
}
