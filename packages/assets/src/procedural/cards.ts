import * as THREE from 'three';
import { buildDrawnTexture, canvasAvailable, type RGB } from './canvas.js';

/** Standard 52-card ranks, ace-high order for display purposes only. */
export const CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type CardRank = (typeof CARD_RANKS)[number];

export type CardSuitCode = 'S' | 'H' | 'D' | 'C';

const SUITS: Record<CardSuitCode, { symbol: string; color: RGB }> = {
  S: { symbol: '♠', color: [20, 20, 24] }, // ♠ black
  C: { symbol: '♣', color: [20, 20, 24] }, // ♣ black
  H: { symbol: '♥', color: [178, 34, 34] }, // ♥ red
  D: { symbol: '♦', color: [178, 34, 34] }, // ♦ red
};

/** `card/<rank><SUIT>`, e.g. `card/AS`, `card/10H`, `card/KC`. */
const CARD_KEY = /^card\/(10|[2-9]|[AJQK])([SHDC])$/;

export function parseCardKey(key: string): { rank: CardRank; suit: CardSuitCode } | undefined {
  const m = CARD_KEY.exec(key);
  if (!m) return undefined;
  return { rank: m[1] as CardRank, suit: m[2] as CardSuitCode };
}

// Same P1-class scale bug as checkers' disc (see packages/games/checkers/src/layout.ts's
// CELL_SIZE comment): these were literal card dimensions in inches-as-world-units, ~7x too
// big for TABLE_RADIUS = 1.3 in packages/presenter/src/index.ts — a single card would have
// spanned nearly half the table. Kept the real 63:88 aspect ratio, scaled down to sit
// comfortably alongside checkers' disc (~0.144 diameter) and codewords' tile (0.15) at this
// table's scale. holdem/presenter.ts's HOLE_CARD_GAP/COMMUNITY_CARD_GAP were sized against
// the old width and must move with this.
const CARD_WIDTH = 0.09;
const CARD_HEIGHT = 0.1257;
const CARD_THICKNESS = 0.002;

// Real CC0 card faces (see /ASSETS.md) — Kenney's Playing Cards Pack,
// served from packages/client/public/ so Vite serves them at this
// absolute path in both dev and the built site. `card_<suit>_<rank>.png`
// is Kenney's own naming: numeric ranks are zero-padded 2 digits
// ("04", "10"), face cards are a bare letter ("A", "J", "Q", "K").
const KENNEY_SUIT_NAME: Record<CardSuitCode, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

function kenneyRankToken(rank: CardRank): string {
  return rank === 'A' || rank === 'J' || rank === 'Q' || rank === 'K' ? rank : rank.padStart(2, '0');
}

function kenneyCardUrl(rank: CardRank, suit: CardSuitCode): string {
  return `/assets/cards/card_${KENNEY_SUIT_NAME[suit]}_${kenneyRankToken(rank)}.png`;
}

const KENNEY_CARD_BACK_URL = '/assets/cards/card_back.png';

function loadKenneyTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A single playing card: a thin box with a real card face/back (Kenney's
 * CC0 Playing Cards Pack, see /ASSETS.md) on a browser where `document` is
 * available; falls back to the original canvas-drawn face (rank + suit
 * glyph, corner pips — nothing copyrighted, drawn entirely in code) under
 * Vitest's default 'node' environment, same constraint every other
 * `document`-touching builder in this file/package already guards against.
 */
export function buildPlayingCard(rank: CardRank, suit: CardSuitCode): THREE.Object3D {
  if (canvasAvailable()) {
    return buildKenneyCard(rank, suit);
  }
  return buildDrawnCard(rank, suit);
}

function buildKenneyCard(rank: CardRank, suit: CardSuitCode): THREE.Object3D {
  const faceTexture = loadKenneyTexture(kenneyCardUrl(rank, suit));
  const backTexture = loadKenneyTexture(KENNEY_CARD_BACK_URL);

  const geometry = new THREE.BoxGeometry(CARD_WIDTH, CARD_THICKNESS, CARD_HEIGHT);
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.9 });
  const materials = [
    edgeMaterial, // +x
    edgeMaterial, // -x
    new THREE.MeshStandardMaterial({ map: faceTexture, roughness: 0.6 }), // +y (face up)
    new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.6 }), // -y (face down)
    edgeMaterial, // +z
    edgeMaterial, // -z
  ];

  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = `card:${rank}${suit}`;
  return mesh;
}

function buildDrawnCard(rank: CardRank, suit: CardSuitCode): THREE.Object3D {
  const { symbol, color } = SUITS[suit];
  const faceTexture = buildDrawnTexture(256, [245, 242, 235], (ctx, size) => {
    ctx.fillStyle = 'rgb(245, 242, 235)';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = size * 0.02;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth);

    const rgb = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    ctx.fillStyle = rgb;
    ctx.textBaseline = 'top';

    const corner = size * 0.11;
    ctx.font = `${Math.round(size * 0.14)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(rank, corner * 0.4, corner * 0.3);
    ctx.font = `${Math.round(size * 0.11)}px sans-serif`;
    ctx.fillText(symbol, corner * 0.4, corner * 1.3);

    ctx.save();
    ctx.translate(size, size);
    ctx.rotate(Math.PI);
    ctx.textAlign = 'left';
    ctx.font = `${Math.round(size * 0.14)}px sans-serif`;
    ctx.fillText(rank, corner * 0.4, corner * 0.3);
    ctx.font = `${Math.round(size * 0.11)}px sans-serif`;
    ctx.fillText(symbol, corner * 0.4, corner * 1.3);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(size * 0.32)}px sans-serif`;
    ctx.fillText(symbol, size / 2, size / 2);
  });

  const backTexture = buildDrawnTexture(256, [30, 60, 110], (ctx, size) => {
    ctx.fillStyle = 'rgb(30, 60, 110)';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1, size * 0.015);
    const step = size / 8;
    for (let x = -size; x < size * 2; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + size, size);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = size * 0.04;
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, size - ctx.lineWidth * 2, size - ctx.lineWidth * 2);
  });

  const geometry = new THREE.BoxGeometry(CARD_WIDTH, CARD_THICKNESS, CARD_HEIGHT);
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.9 });
  const materials = [
    edgeMaterial, // +x
    edgeMaterial, // -x
    new THREE.MeshStandardMaterial({ map: faceTexture, roughness: 0.6 }), // +y (face up)
    new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.6 }), // -y (face down)
    edgeMaterial, // +z
    edgeMaterial, // -z
  ];

  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = `card:${rank}${suit}`;
  return mesh;
}

/** The card back alone, e.g. for face-down piles/decks. */
export function buildCardBack(): THREE.Object3D {
  // Reuse the same geometry/material path via an arbitrary rank/suit, then
  // rename — the back texture doesn't depend on rank/suit.
  const card = buildPlayingCard('A', 'S');
  card.name = 'card:back';
  return card;
}
