import * as THREE from 'three';
import { buildDrawnTexture } from './canvas.js';

const PIP_LAYOUTS: Record<number, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.28, 0.28],
    [0.5, 0.5],
    [0.72, 0.72],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  6: [
    [0.28, 0.24],
    [0.72, 0.24],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.76],
    [0.72, 0.76],
  ],
};

function buildFaceTexture(pips: number): THREE.Texture {
  return buildDrawnTexture(128, [245, 245, 240], (ctx, size) => {
    ctx.fillStyle = 'rgb(245, 245, 240)';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgb(30, 30, 30)';
    const radius = size * 0.09;
    for (const [nx, ny] of PIP_LAYOUTS[pips]) {
      ctx.beginPath();
      ctx.arc(nx * size, ny * size, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// BoxGeometry material group order is [+x, -x, +y, -y, +z, -z]. Opposite
// faces of a standard die sum to 7, so pair index 0/1, 2/3, 4/5 that way.
const FACE_PIP_ORDER = [1, 6, 2, 5, 3, 4];

/** A single six-sided die with canvas-drawn pip faces (no photographed/scanned art). */
export function buildDie(size = 0.4): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(size, size, size);
  // Slightly rounded look is out of scope for a placeholder primitive —
  // a plain cube reads unambiguously as "die" once pipped.
  const materials = FACE_PIP_ORDER.map(
    (pips) => new THREE.MeshStandardMaterial({ map: buildFaceTexture(pips), roughness: 0.4 }),
  );
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = 'dice:d6';
  return mesh;
}
