import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createPresenterCtx } from './presenter-ctx.js';
import { PlaceholderAssetLoader } from './placeholder-asset-loader.js';
import type { CameraDirector, CameraPose } from '../camera/director.js';

/**
 * A6's real CameraDirector isn't available in this worktree (parallel
 * build — see this wave's assignment). This fake satisfies the frozen
 * seam type from packages/client/src/camera/director.ts so PresenterCtx
 * assembly can be tested in isolation.
 */
function createFakeCameraDirector(): CameraDirector & { homePose: CameraPose | null } {
  return {
    homePose: null,
    async focus() {},
    async home() {},
    setHome(pose: CameraPose) {
      this.homePose = pose;
    },
    snap() {},
  };
}

describe('createPresenterCtx', () => {
  it('assembles scene/table/seats/localSeat/assets/camera/emit per docs/ARCHITECTURE.md §6', () => {
    const camera = createFakeCameraDirector();
    const emitted: unknown[] = [];

    const ctx = createPresenterCtx({
      seatCount: 4,
      localSeat: 2,
      camera,
      emit: (action) => emitted.push(action),
    });

    expect(ctx.scene).toBeInstanceOf(THREE.Scene);
    expect(ctx.table).toBeInstanceOf(THREE.Object3D);
    expect(ctx.seats).toHaveLength(4);
    expect(ctx.localSeat).toBe(2);
    expect(ctx.assets).toBeInstanceOf(PlaceholderAssetLoader);
    expect(ctx.camera).toBe(camera);

    ctx.emit({ t: 'ping' });
    expect(emitted).toEqual([{ t: 'ping' }]);
  });

  it('pushes the local seat pose to the camera director as home', () => {
    const camera = createFakeCameraDirector();
    const ctx = createPresenterCtx({ seatCount: 6, localSeat: 3, camera });

    expect(camera.homePose).toEqual(ctx.seats[3].cameraPose);
  });

  it('adds every seat avatar into the assembled scene', () => {
    const camera = createFakeCameraDirector();
    const ctx = createPresenterCtx({ seatCount: 5, localSeat: 0, camera });

    for (const seat of ctx.seats) {
      expect(ctx.scene.children).toContain(seat.avatar);
    }
  });

  it('accepts an injected AssetLoader instead of the default placeholder', async () => {
    const camera = createFakeCameraDirector();
    const customLoad = vi.fn(async () => new THREE.Object3D());
    const ctx = createPresenterCtx({
      seatCount: 2,
      localSeat: 0,
      camera,
      assets: { load: customLoad },
    });

    expect(ctx.assets).not.toBeInstanceOf(PlaceholderAssetLoader);
    await ctx.assets.load('some-piece');
    expect(customLoad).toHaveBeenCalledWith('some-piece');
  });

  it('defaults emit to a harmless no-op when not supplied', () => {
    const camera = createFakeCameraDirector();
    const ctx = createPresenterCtx({ seatCount: 2, localSeat: 0, camera });
    expect(() => ctx.emit({ anything: true })).not.toThrow();
  });
});

describe('PlaceholderAssetLoader', () => {
  it('resolves any key to an Object3D and never rejects', async () => {
    const loader = new PlaceholderAssetLoader();
    const result = await loader.load('checkers-piece');
    expect(result).toBeInstanceOf(THREE.Object3D);
  });
});
