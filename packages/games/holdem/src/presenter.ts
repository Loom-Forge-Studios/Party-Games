// Client-side presenter: turns HoldemView into a 3D scene (community cards,
// per-seat hole cards and chip stacks) and HoldemAction button presses into
// ctx.emit() calls. No rules live here — see docs/ARCHITECTURE.md §6/§7 and
// module.ts's header for the rules/presenter split this enforces.
//
// PresenterCtx has no dedicated slot for game-specific 2D UI (action
// buttons, pot readout), so this presenter owns a small fixed-position DOM
// overlay of its own, appended to `document.body` on mount and removed on
// unmount — the same `el`/`clear` DOM helper the rest of the client uses.

import * as THREE from 'three';
import type { PresenterCtx, GamePresenter } from '@party/presenter';
import { TABLE_SURFACE_Y, el, clear } from '@party/presenter';
import type { GameEvent } from '@party/protocol';
import { cardAssetKey } from './deck.js';
import type { HoldemAction, HoldemView } from './state.js';

const HOLE_CARD_DISTANCE_RATIO = 0.42; // fraction of the way from table centre toward the seat
// Card width is 0.09 (packages/assets/src/procedural/cards.ts) — these gaps must stay a bit
// larger than that so adjacent cards don't overlap.
const HOLE_CARD_GAP = 0.11;
const COMMUNITY_CARD_GAP = 0.12;
const CHIP_STACK_DISTANCE_RATIO = 0.72;
const CHIP_BET_DISTANCE_RATIO = 0.5;

/** Removes every child of a group without disposing shared geometry/material — see placeCard(). */
function clearGroup(group: THREE.Group): void {
  while (group.children.length > 0) {
    group.remove(group.children[0]);
  }
}

export class HoldemPresenter implements GamePresenter<HoldemView> {
  readonly gameId = 'holdem';

  private ctx: PresenterCtx | null = null;
  private root: THREE.Group | null = null;
  private communityGroup: THREE.Group | null = null;
  private holeCardGroups: THREE.Group[] = [];
  private chipGroups: THREE.Group[] = [];
  private hud: HTMLElement | null = null;

  async mount(ctx: PresenterCtx): Promise<void> {
    this.ctx = ctx;

    const root = new THREE.Group();
    root.name = 'holdem-root';
    ctx.table.add(root);
    this.root = root;

    this.communityGroup = new THREE.Group();
    this.communityGroup.name = 'holdem-community';
    root.add(this.communityGroup);

    this.holeCardGroups = ctx.seats.map((seat) => {
      const group = new THREE.Group();
      group.name = `holdem-hole-${seat.seat}`;
      const t = HOLE_CARD_DISTANCE_RATIO;
      group.position.set(seat.position.x * t, TABLE_SURFACE_Y + 0.01, seat.position.z * t);
      group.rotation.y = seat.rotationY;
      root.add(group);
      return group;
    });

    this.chipGroups = ctx.seats.map((seat) => {
      const group = new THREE.Group();
      group.name = `holdem-chips-${seat.seat}`;
      const t = CHIP_STACK_DISTANCE_RATIO;
      group.position.set(seat.position.x * t, TABLE_SURFACE_Y, seat.position.z * t);
      root.add(group);
      return group;
    });

    this.hud = el('div', {
      class: 'holdem-hud',
      style:
        'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);' +
        'background:rgba(20,20,24,0.78);color:#f2efe8;padding:10px 14px;border-radius:10px;' +
        'font:14px system-ui,sans-serif;display:flex;flex-direction:column;gap:8px;align-items:center;' +
        'z-index:20;pointer-events:auto;',
    });
    document.body.appendChild(this.hud);
  }

  renderView(view: HoldemView): void {
    if (!this.ctx) return;
    this.renderCommunity(view);
    this.renderSeats(view);
    this.renderHud(view);
  }

  async playEvent(ev: GameEvent): Promise<void> {
    // The state driving this event's visuals was already applied by the renderView() call the
    // host makes immediately before playEvent() (see docs/ARCHITECTURE.md §3 step 5). This
    // presenter's job here is just to sequence the camera to match — see CameraDirector.focus().
    if (this.ctx && ev.focus) {
      await this.ctx.camera.focus(ev.focus);
    }
  }

  unmount(): void {
    if (this.root && this.ctx) {
      this.ctx.table.remove(this.root);
    }
    this.hud?.remove();
    this.ctx = null;
    this.root = null;
    this.communityGroup = null;
    this.holeCardGroups = [];
    this.chipGroups = [];
    this.hud = null;
  }

  // -- 3D -------------------------------------------------------------------

  private placeCard(group: THREE.Group, key: string, x: number, z: number, rotationY: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // load() never rejects (see @party/assets) and caches by key, so every caller shares the
    // same source Object3D — always clone() before adding it at a new position.
    void ctx.assets.load(key).then((asset) => {
      const mesh = (asset as THREE.Object3D).clone(true);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rotationY;
      group.add(mesh);
    });
  }

  private placeChipStack(group: THREE.Group, x: number, z: number, amount: number, accent: boolean): void {
    if (amount <= 0) return;
    const height = Math.min(0.22, 0.015 + Math.log10(Math.max(1, amount)) * 0.045);
    const radius = accent ? 0.045 : 0.075;
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
    const material = new THREE.MeshStandardMaterial({ color: accent ? 0xd9a441 : 0x8f2d2d, roughness: 0.55 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, height / 2, z);
    group.add(mesh);
  }

  private renderCommunity(view: HoldemView): void {
    if (!this.communityGroup) return;
    clearGroup(this.communityGroup);
    const totalWidth = (view.community.length - 1) * COMMUNITY_CARD_GAP;
    view.community.forEach((card, i) => {
      this.placeCard(this.communityGroup as THREE.Group, cardAssetKey(card), -totalWidth / 2 + i * COMMUNITY_CARD_GAP, 0, 0);
    });
  }

  private renderSeats(view: HoldemView): void {
    const ctx = this.ctx;
    if (!ctx) return;

    for (const seat of ctx.seats) {
      const holeGroup = this.holeCardGroups[seat.seat];
      const chipGroup = this.chipGroups[seat.seat];
      if (!holeGroup || !chipGroup) continue;
      clearGroup(holeGroup);
      clearGroup(chipGroup);

      const player = view.players.find((p) => p.seat === seat.seat);
      if (!player) continue;

      const reveal = view.lastShowdown?.find((r) => r.seat === seat.seat) ?? null;
      const own = view.you && view.you.seat === seat.seat ? view.you : null;
      const faceUpCards = reveal ? reveal.holeCards : own ? own.holeCards : null;

      if (faceUpCards && faceUpCards.length > 0) {
        const totalWidth = (faceUpCards.length - 1) * HOLE_CARD_GAP;
        faceUpCards.forEach((card, i) => {
          this.placeCard(holeGroup, cardAssetKey(card), -totalWidth / 2 + i * HOLE_CARD_GAP, 0, 0);
        });
      } else if (player.holeCardCount > 0 && !player.folded) {
        const totalWidth = (player.holeCardCount - 1) * HOLE_CARD_GAP;
        for (let i = 0; i < player.holeCardCount; i++) {
          this.placeCard(holeGroup, 'card/back', -totalWidth / 2 + i * HOLE_CARD_GAP, 0, 0);
        }
      }

      this.placeChipStack(chipGroup, 0, 0, player.stack, false);
      if (player.committedRound > 0) {
        const inward = CHIP_BET_DISTANCE_RATIO / CHIP_STACK_DISTANCE_RATIO - 1;
        this.placeChipStack(chipGroup, seat.position.x * inward, seat.position.z * inward, player.committedRound, true);
      }
    }
  }

  // -- HUD --------------------------------------------------------------------

  private renderHud(view: HoldemView): void {
    const ctx = this.ctx;
    if (!this.hud || !ctx) return;
    clear(this.hud);

    this.hud.appendChild(
      el('div', { class: 'holdem-hud__info' }, [
        `Hand #${view.handNumber} · ${streetLabel(view.street)} · Pot ${view.pot}`,
      ]),
    );

    const isMyTurn = view.you !== null && view.actingSeat !== null && view.actingSeat === view.you.seat;
    if (!isMyTurn || !view.you) return;

    const me = view.players.find((p) => p.seat === view.you?.seat);
    if (!me) return;

    const toCall = Math.max(0, view.currentBet - me.committedRound);
    const canCheck = toCall <= 0;
    const minTo = view.currentBet === 0 ? Math.min(view.minRaiseSize, me.stack) : Math.min(view.currentBet + view.minRaiseSize, me.committedRound + me.stack);
    const maxTo = me.committedRound + me.stack;

    const amountInput = el('input', {
      type: 'number',
      min: String(Math.min(minTo, maxTo)),
      max: String(maxTo),
      value: String(Math.min(minTo, maxTo)),
      'data-testid': 'holdem-amount',
      style: 'width:5.5em;',
    });

    const emit = (action: HoldemAction) => ctx.emit(action);

    this.hud.appendChild(
      el('div', { class: 'holdem-hud__actions' }, [
        el('button', { onclick: () => emit({ type: 'fold' }) }, ['Fold']),
        canCheck
          ? el('button', { onclick: () => emit({ type: 'check' }) }, ['Check'])
          : el('button', { onclick: () => emit({ type: 'call' }) }, [`Call ${Math.min(toCall, me.stack)}`]),
        amountInput,
        el(
          'button',
          {
            onclick: () => {
              const amount = Math.round(Number(amountInput.value));
              emit(view.currentBet === 0 ? { type: 'bet', amount } : { type: 'raise', amount });
            },
          },
          [view.currentBet === 0 ? 'Bet' : 'Raise'],
        ),
        el('button', { onclick: () => emit({ type: 'allin' }) }, [`All-in (${me.stack})`]),
      ]),
    );
  }
}

function streetLabel(street: HoldemView['street']): string {
  switch (street) {
    case 'preflop':
      return 'Preflop';
    case 'flop':
      return 'Flop';
    case 'turn':
      return 'Turn';
    case 'river':
      return 'River';
    case 'handOver':
      return 'Hand over';
    case 'gameOver':
      return 'Game over';
    default:
      return street;
  }
}

export const holdemPresenter = new HoldemPresenter();
