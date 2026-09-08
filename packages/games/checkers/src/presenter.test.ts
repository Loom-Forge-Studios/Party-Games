// Smoke-level tests only, per this wave's DoD note — presenter.ts is
// exercised end-to-end visually once it's actually wired into the running
// client app (out of this package's scope; see presenter.ts's header
// comment on the PresenterCtx camera-access assumption). These tests just
// confirm mount/renderView/playEvent/unmount do what they say against a
// hand-built fake PresenterCtx, entirely in Node (three.js's core object
// graph works fine without a real WebGL context).

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { PresenterCtx } from '@party/client';
import { createRng } from '@party/engine';
import * as B from './board.js';
import { checkersModule, type CheckersView } from './module.js';
import { CheckersPresenter } from './presenter.js';

function fakeAssetLoader() {
  const templates = new Map<string, THREE.Object3D>();
  return {
    async load(key: string): Promise<unknown> {
      // Mirrors the real PlaceholderAssetLoader: the SAME object instance
      // for repeated calls with the same key, so the presenter's own
      // clone-per-piece logic (see presenter.ts's syncPiece) is genuinely
      // exercised rather than trivially satisfied by a fresh object each time.
      let template = templates.get(key);
      if (!template) {
        template = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8), new THREE.MeshStandardMaterial());
        template.name = key;
        templates.set(key, template);
      }
      return template;
    },
  };
}

function fakeCameraDirector() {
  return {
    focus: vi.fn(async (_hint: unknown) => {}),
    home: vi.fn(async () => {}),
    setHome: vi.fn(),
    snap: vi.fn(),
  };
}

function fakeSeat(seat: number) {
  return {
    seat,
    position: { x: 0, y: 0, z: seat === 0 ? 1 : -1 },
    rotationY: 0,
    avatar: new THREE.Object3D(),
    cameraPose: { position: { x: 0, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } },
  };
}

function makeCtx() {
  const scene = new THREE.Scene();
  const table = new THREE.Object3D();
  scene.add(table);
  const emitted: unknown[] = [];
  const camera = fakeCameraDirector();
  const ctx = {
    scene,
    table,
    seats: [fakeSeat(0), fakeSeat(1)],
    localSeat: 0,
    assets: fakeAssetLoader(),
    camera,
    emit: (action: unknown) => emitted.push(action),
  } as unknown as PresenterCtx;
  return { ctx, emitted, camera };
}

function setupView(): { state: ReturnType<typeof checkersModule.setup>; view: CheckersView } {
  const state = checkersModule.setup({
    players: [
      { id: 'a', username: 'a', seat: 0, connected: true, isHost: true },
      { id: 'b', username: 'b', seat: 1, connected: true, isHost: false },
    ],
    rng: createRng(1),
  });
  return { state, view: checkersModule.view(state, 'a') };
}

describe('CheckersPresenter — smoke', () => {
  it('mount() builds a 64-tile board and an empty piece group under ctx.table', async () => {
    const presenter = new CheckersPresenter();
    const { ctx } = makeCtx();
    await presenter.mount(ctx);

    const board = ctx.table.getObjectByName('checkers:board');
    const pieces = ctx.table.getObjectByName('checkers:pieces');
    expect(board).toBeDefined();
    expect(pieces).toBeDefined();
    expect(board!.children).toHaveLength(64);
    expect(pieces!.children).toHaveLength(0);
  });

  it('renderView() places one mesh per piece on the board (24 at the opening position)', async () => {
    const presenter = new CheckersPresenter();
    const { ctx } = makeCtx();
    await presenter.mount(ctx);

    const { view } = setupView();
    presenter.renderView(view);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const pieceGroup = ctx.table.getObjectByName('checkers:pieces')!;
    expect(pieceGroup.children).toHaveLength(24);
  });

  it('playEvent() forwards the event FocusHint to ctx.camera.focus() and resolves', async () => {
    const presenter = new CheckersPresenter();
    const { ctx, camera } = makeCtx();
    await presenter.mount(ctx);

    const { state, view } = setupView();
    presenter.renderView(view);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const { events } = checkersModule.reduce(
      state,
      { type: 'move', from: B.rowColToSquare(5, 2), to: B.rowColToSquare(4, 1) },
      { actor: 'a', rng: createRng(2) },
    );

    for (const ev of events) {
      await presenter.playEvent(ev);
    }

    expect(camera.focus).toHaveBeenCalledTimes(events.length);
    expect(camera.focus.mock.calls[0]![0]).toEqual(events[0]!.focus);
  });

  it('unmount() removes the board and piece groups and stops listening', async () => {
    const presenter = new CheckersPresenter();
    const { ctx } = makeCtx();
    await presenter.mount(ctx);
    expect(ctx.table.children.length).toBeGreaterThan(0);

    presenter.unmount();
    expect(ctx.table.children).toHaveLength(0);
  });
});
