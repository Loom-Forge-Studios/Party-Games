// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createScene, PlaceholderAssetLoader, type CameraDirector, type PresenterCtx, type SeatLayout } from '@party/client';
import type { FocusHint, GameEvent } from '@party/engine';
import { HoldemPresenter } from './presenter.js';
import type { HoldemView } from './state.js';

class FakeCameraDirector implements CameraDirector {
  readonly focusCalls: FocusHint[] = [];
  async focus(hint: FocusHint): Promise<void> {
    this.focusCalls.push(hint);
  }
  async home(): Promise<void> {}
  setHome(): void {}
  snap(): void {}
}

/**
 * Minimal hand-built seats instead of @party/client's computeSeatLayout(): that helper builds a
 * real placeholder avatar with a canvas-drawn nameplate texture, which needs a `canvas` 2D
 * context this jsdom test environment doesn't provide (client's own avatar.ts falls back
 * gracefully when `document` is missing entirely, but jsdom does define `document` — just
 * without canvas support — so it takes the noisy-but-harmless jsdom "not implemented" path
 * instead). This presenter doesn't touch `seat.avatar` at all, so a bare Group stands in fine.
 */
function buildSeats(count: number): SeatLayout[] {
  const seats: SeatLayout[] = [];
  for (let seat = 0; seat < count; seat++) {
    const angle = (seat / count) * Math.PI * 2;
    const x = Math.sin(angle) * 2.1;
    const z = Math.cos(angle) * 2.1;
    seats.push({
      seat,
      position: { x, y: 0, z },
      rotationY: 0,
      avatar: new THREE.Group(),
      cameraPose: { position: { x, y: 1.55, z }, target: { x: 0, y: 0.4, z: 0 } },
    });
  }
  return seats;
}

function buildCtx(): { ctx: PresenterCtx; camera: FakeCameraDirector; emitted: unknown[] } {
  const { scene, table } = createScene();
  const seats = buildSeats(3);
  const camera = new FakeCameraDirector();
  const emitted: unknown[] = [];
  const ctx: PresenterCtx = {
    scene,
    table,
    seats,
    localSeat: 0,
    assets: new PlaceholderAssetLoader(),
    camera,
    emit: (action) => emitted.push(action),
  };
  return { ctx, camera, emitted };
}

function sampleView(): HoldemView {
  return {
    street: 'preflop',
    dealerSeat: 0,
    smallBlindAmt: 5,
    bigBlindAmt: 10,
    community: [],
    pot: 15,
    currentBet: 10,
    minRaiseSize: 10,
    actingSeat: 0,
    players: [
      { id: 'A', seat: 0, stack: 995, committedRound: 5, committedTotal: 5, folded: false, allIn: false, inHand: true, eliminated: false, holeCardCount: 2 },
      { id: 'B', seat: 1, stack: 990, committedRound: 10, committedTotal: 10, folded: false, allIn: false, inHand: true, eliminated: false, holeCardCount: 2 },
      { id: 'C', seat: 2, stack: 1000, committedRound: 0, committedTotal: 0, folded: true, allIn: false, inHand: true, eliminated: false, holeCardCount: 0 },
    ],
    you: { id: 'A', seat: 0, holeCards: [{ rank: 14, suit: 'S' }, { rank: 13, suit: 'S' }] },
    lastShowdown: null,
    lastAwards: null,
    handNumber: 1,
    winnerPlayerId: null,
  };
}

describe('HoldemPresenter smoke test', () => {
  it('mounts, renders a view, plays a focused event, and unmounts cleanly', async () => {
    const presenter = new HoldemPresenter();
    expect(presenter.gameId).toBe('holdem');

    const { ctx, camera } = buildCtx();
    await presenter.mount(ctx);

    expect(() => presenter.renderView(sampleView())).not.toThrow();

    const event: GameEvent = {
      type: 'bet.placed',
      payload: { seat: 0, kind: 'call', amount: 5 },
      focus: { target: { kind: 'seat', seat: 0 }, holdMs: 10 },
      actor: 'A',
    };
    await presenter.playEvent(event);
    expect(camera.focusCalls).toHaveLength(1);
    expect(camera.focusCalls[0]).toEqual(event.focus);

    // A second, idempotent renderView (e.g. after a reconnect) should also not throw.
    const nextView = sampleView();
    nextView.community = [{ rank: 2, suit: 'H' }, { rank: 3, suit: 'D' }, { rank: 4, suit: 'C' }];
    nextView.street = 'flop';
    expect(() => presenter.renderView(nextView)).not.toThrow();

    expect(() => presenter.unmount()).not.toThrow();
    // Unmounting removes the HUD overlay it added to the document.
    expect(document.querySelector('.holdem-hud')).toBeNull();
  });
});
