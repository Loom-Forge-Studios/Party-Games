import * as THREE from 'three';
import { buildDrawnTexture, type RGB } from './canvas.js';

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

const CARD_WIDTH = 0.63;
const CARD_HEIGHT = 0.88;
const CARD_THICKNESS = 0.004;

/**
 * A single playing card: a thin box with a canvas-drawn face (rank + suit
 * glyph, corner pips) on the front and a plain patterned back. All text and
 * geometry is drawn here — no scanned/photographed card art, so there is
 * nothing copyrighted to clear.
 */
export function buildPlayingCard(rank: CardRank, suit: CardSuitCode): THREE.Object3D {
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
