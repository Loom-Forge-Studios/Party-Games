// Smoke-level presenter tests, per this wave's brief ("presenter.ts can be
// typechecked but doesn't need exhaustive tests this wave — a couple of
// smoke-level tests are enough"). Runs under Vitest's default `node`
// environment (no jsdom) — buildLabelTexture()'s canvas-availability check
// degrades to a flat DataTexture without a DOM, the same pattern
// packages/assets/src/procedural/canvas.ts uses, so this needs no browser.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { PresenterCtx, CameraDirector, CameraPose, SeatLayout } from '@party/presenter';
import type { AssetLoader } from '@party/assets';
import { createRng } from '@party/engine';
import type { FocusHint } from '@party/protocol';
import { codewordsModule, GRID_SIZE, type CodewordsView } from './module.js';
import { CodewordsPresenter } from './presenter.js';

/** Trivial fake — always resolves to a bare Object3D, matching AssetLoader's "never rejects" contract without needing the real procedural placeholder kit for a presenter-only test. */
class FakeAssetLoader implements AssetLoader {
  async load(): Promise<unknown> {
    return new THREE.Object3D();
  }
}

/** Hand-built seats instead of @party/client's computeSeatLayout(), to avoid a dependency on @party/client from this package (which would be circular — see docs/ARCHITECTURE.md / packages/presenter's header comment). This presenter doesn't touch seat.avatar. */
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

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    username: `p${i}`,
    seat: i,
    connected: true,
    isHost: i === 0,
  }));
}

function createFakeCameraDirector(): CameraDirector & { focusCalls: FocusHint[] } {
  return {
    focusCalls: [],
    async focus(hint: FocusHint) {
      this.focusCalls.push(hint);
    },
    async home() {},
    setHome(_pose: CameraPose) {},
    snap() {},
  };
}

function buildViewFor(seat: number): { view: CodewordsView; ctx: PresenterCtx; camera: ReturnType<typeof createFakeCameraDirector>; emitted: unknown[] } {
  const players = makePlayers(4);
  const state = codewordsModule.setup({ players, rng: createRng(1) });
  const view = codewordsModule.view(state, `p${seat}`);
  const camera = createFakeCameraDirector();
  const emitted: unknown[] = [];
  const seats = buildSeats(4);
  camera.setHome(seats[seat].cameraPose);
  const ctx: PresenterCtx = {
    scene: new THREE.Scene(),
    table: new THREE.Object3D(),
    seats,
    localSeat: seat,
    assets: new FakeAssetLoader(),
    camera,
    emit: (action) => emitted.push(action),
  };
  return { view, ctx, camera, emitted };
}

describe('CodewordsPresenter smoke tests', () => {
  it('mount() builds a GRID_SIZE x GRID_SIZE grid of named, lookup-able tile groups on the table', async () => {
    const { ctx } = buildViewFor(0);
    const presenter = new CodewordsPresenter();
    await presenter.mount(ctx);

    const tileNames = new Set<string>();
    ctx.table.traverse((obj) => {
      if (/^tile-\d-\d$/.test(obj.name)) tileNames.add(obj.name);
    });
    expect(tileNames.size).toBe(GRID_SIZE * GRID_SIZE);
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        expect(tileNames.has(`tile-${r}-${c}`)).toBe(true);
      }
    }
  });

  it('renderView() is idempotent and does not throw across repeated calls, including after a reveal', async () => {
    const { view, ctx } = buildViewFor(1);
    const presenter = new CodewordsPresenter();
    await presenter.mount(ctx);

    expect(() => presenter.renderView(view)).not.toThrow();
    expect(() => presenter.renderView(view)).not.toThrow(); // idempotent re-render, e.g. reconnect

    const revealedView: CodewordsView = {
      ...view,
      tiles: view.tiles.map((t, i) => (i === 0 ? { ...t, revealed: true, color: 'neutral' } : t)),
    };
    expect(() => presenter.renderView(revealedView)).not.toThrow();
  });

  it('playEvent() forwards the event\'s FocusHint to the CameraDirector', async () => {
    const { view, ctx, camera } = buildViewFor(2);
    const presenter = new CodewordsPresenter();
    await presenter.mount(ctx);
    presenter.renderView(view);

    const hint: FocusHint = { target: { kind: 'object', id: 'tile-0-0' }, holdMs: 1400 };
    await presenter.playEvent({ type: 'tile.revealed', payload: {}, focus: hint });
    expect(camera.focusCalls).toEqual([hint]);

    await presenter.playEvent({ type: 'chat.aside', payload: {} }); // no focus — should not throw or call camera
    expect(camera.focusCalls).toHaveLength(1);
  });

  it('handleTileClick() only emits when it is the local player\'s turn to guess', async () => {
    const players = makePlayers(4);
    const state = codewordsModule.setup({ players, rng: createRng(3) });
    const guesserId = state.teams[state.turnTeam].guessers[0]!;
    const guesserSeat = state.playerSeat[guesserId]!;

    const view = codewordsModule.view(state, guesserId);
    const camera = createFakeCameraDirector();
    const emitted: unknown[] = [];
    const seats = buildSeats(4);
    camera.setHome(seats[guesserSeat].cameraPose);
    const ctx: PresenterCtx = {
      scene: new THREE.Scene(),
      table: new THREE.Object3D(),
      seats,
      localSeat: guesserSeat,
      assets: new FakeAssetLoader(),
      camera,
      emit: (a) => emitted.push(a),
    };

    const presenter = new CodewordsPresenter();
    await presenter.mount(ctx);
    presenter.renderView(view); // still 'clue' phase — guesser can't act yet

    presenter.handleTileClick('tile-0-0');
    expect(emitted).toHaveLength(0);

    const spymaster = state.teams[state.turnTeam].spymaster;
    const { state: guessState } = codewordsModule.reduce(
      state,
      { type: 'clue.give', word: 'zzzblorptron', count: 2 },
      { actor: spymaster, rng: createRng(3) },
    );
    presenter.renderView(codewordsModule.view(guessState, guesserId));

    presenter.handleTileClick('tile-0-0');
    expect(emitted).toEqual([{ type: 'tile.guess', tileId: 'tile-0-0' }]);
  });

  it('unmount() removes every tile group and the clue panel from the table', async () => {
    const { view, ctx } = buildViewFor(0);
    const presenter = new CodewordsPresenter();
    await presenter.mount(ctx);
    presenter.renderView(view);

    const before = ctx.table.children.length;
    expect(before).toBeGreaterThan(0);

    presenter.unmount();

    let remaining = 0;
    ctx.table.traverse((obj) => {
      if (/^tile-\d-\d$/.test(obj.name) || obj.name === 'codewords-clue-panel') remaining += 1;
    });
    expect(remaining).toBe(0);
  });

  it('scene/table objects are real THREE.Object3D instances (sanity check against the frozen PresenterCtx shape)', async () => {
    const { ctx } = buildViewFor(0);
    expect(ctx.scene).toBeInstanceOf(THREE.Scene);
    expect(ctx.table).toBeInstanceOf(THREE.Object3D);
  });
});
