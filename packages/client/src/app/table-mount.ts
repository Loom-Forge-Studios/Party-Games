// Overseer integration step, deliberately not owned by any Wave 1/2 agent
// — index.html says so explicitly ("onTableHandoff is left unset here...
// wiring it... is the overseer's cross-cutting integration step"), and
// packages/client/src/app/index.ts's own header comment says the same.
//
// This is the glue between the lobby→table handoff (A4), the real 3D
// scene + PresenterCtx factory (A5), the real camera director (A6), and a
// dynamically-loaded per-game GamePresenter (Wave 2). Nothing here
// implements game rules or camera behaviour — it only wires already-built
// pieces together and forwards server messages to the mounted presenter.

import type { RoomState } from '@party/protocol';
import type { Connection } from './connection.js';
import type { AppStore } from './store.js';
import { loadGamePresenter } from './game-presenters.js';
import {
  createRenderer,
  createRenderLoop,
  attachResizeHandling,
  createDefaultCamera,
} from '../table/renderer.js';
import { createPresenterCtx } from '../table/presenter-ctx.js';
import { ThreeCameraDirector } from '../camera/CameraDirector.js';
import { el } from '../ui/dom.js';

export interface TableMountOptions {
  /** The container index.html reserves for the 3D canvas (see #app-canvas) — sibling to, not inside, the DOM overlay root. */
  canvasContainer: HTMLElement;
  room: RoomState;
  connection: Connection;
  store: AppStore;
}

export interface MountedTable {
  unmount(): void;
}

/**
 * Mounts the 3D table + the room's game presenter into `canvasContainer`,
 * and wires the connection's incoming game.view/game.events/game.over
 * messages to it. Call once per lobby→table transition (see
 * app/index.ts's `onTableHandoff`); call the returned `unmount()` before
 * mounting again (e.g. on a fresh handoff after returning to the lobby).
 */
export async function mountTable(opts: TableMountOptions): Promise<MountedTable> {
  const { canvasContainer, room, connection, store } = opts;

  if (!room.gameId) {
    throw new Error('mountTable: room.gameId is null — cannot mount a presenter for a room with no game selected');
  }

  const localPlayerId = store.getState().localPlayerId;
  const localSeat = room.players.find((p) => p.id === localPlayerId)?.seat ?? 0;
  const seatCount = room.players.length;
  const labels = [...room.players].sort((a, b) => a.seat - b.seat).map((p) => p.username);

  canvasContainer.replaceChildren();
  if (!canvasContainer.style.position) canvasContainer.style.position = 'relative';
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvasContainer.appendChild(canvas);

  const aspect = canvasContainer.clientWidth / Math.max(1, canvasContainer.clientHeight);
  const camera = createDefaultCamera(aspect || 1);
  const renderer = createRenderer(canvas);

  const cameraDirector = new ThreeCameraDirector({ camera });

  const ctx = createPresenterCtx({
    seatCount,
    localSeat,
    camera: cameraDirector,
    labels,
    emit: (action) => connection.send({ t: 'game.action', action }),
  });

  const loop = createRenderLoop(renderer, ctx.scene, camera);
  const detachResize = attachResizeHandling(canvasContainer, renderer, camera, loop);

  // ThreeCameraDirector eases poses on its own internal rAF loop but has no
  // "something changed, please redraw" hook (nothing in Wave 1 built one —
  // see docs/ARCHITECTURE.md's camera section, which only specifies
  // focus/home/setHome/snap). Rather than leave the screen frozen mid-ease,
  // this drives the idle-when-still render loop continuously for as long as
  // a table is mounted, trading the battery-saving idle optimisation for
  // correctness. A follow-up that adds an onPoseChange-style hook to
  // CameraDirector could restore the idle behaviour without touching this
  // file's contract.
  let tickHandle: number | null = requestAnimationFrame(function tick() {
    loop.requestRender();
    tickHandle = requestAnimationFrame(tick);
  });

  const presenter = await loadGamePresenter(room.gameId);
  await presenter.mount(ctx);

  let eventChain: Promise<void> = Promise.resolve();
  let banner: HTMLElement | null = null;

  const unsubscribe = connection.onMessage((message) => {
    switch (message.t) {
      case 'game.view':
        presenter.renderView(message.view);
        break;
      case 'game.events':
        // Play sequentially (each event's animation — and any camera
        // move it triggers — finishes before the next starts), matching
        // playEvent's documented "resolves when the animation is
        // finished" contract.
        for (const ev of message.events) {
          eventChain = eventChain.then(() => presenter.playEvent(ev));
        }
        break;
      case 'game.over': {
        banner?.remove();
        const text =
          message.result.winners.length > 0
            ? `Game over — winner: ${message.result.winners.join(', ')} (${message.result.reason})`
            : `Game over — ${message.result.reason}`;
        banner = el(
          'div',
          {
            class: 'pg-game-over-banner',
            role: 'status',
            'aria-live': 'polite',
            style:
              'position:absolute;top:1rem;left:50%;transform:translateX(-50%);' +
              'background:rgba(20,20,24,0.85);color:#fff;padding:0.75rem 1.5rem;' +
              'border-radius:0.5rem;font:600 1rem system-ui,sans-serif;z-index:10;',
          },
          [text],
        );
        canvasContainer.appendChild(banner);
        break;
      }
      default:
        break;
    }
  });

  return {
    unmount(): void {
      unsubscribe();
      if (tickHandle !== null) cancelAnimationFrame(tickHandle);
      presenter.unmount();
      detachResize();
      renderer.dispose();
      canvasContainer.replaceChildren();
    },
  };
}
