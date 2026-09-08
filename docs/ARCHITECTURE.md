# Party Games — Architecture

This document is self-contained: every later agent reads this instead of any
external planning doc. If something you need to know isn't here, that's a
gap worth reporting, not a reason to guess.

## 1. System diagram

```
                         ┌─────────────────────────────┐
                         │   Ubuntu mini PC (host)      │
                         │                              │
   Browser               │   ┌────────┐   ┌──────────┐  │
   (client)   ──WSS──────┼──▶│ Caddy  │──▶│  Node    │  │
   Three.js + TS         │   │ (TLS,  │   │  + ws    │  │
                         │   │ reverse│   │  server  │  │
                         │   │ proxy) │   │          │  │
                         │   └────────┘   └────┬─────┘  │
                         │                      │        │
                         └──────────────────────┼────────┘
                                                 │
                          ┌──────────────────────┼──────────────────────┐
                          │  @party/server                              │
                          │                                             │
                          │  net/     sessions, reconnect, framing      │
                          │  rooms/   room manager (create/join/leave)  │
                          │  host/    game host runtime, wraps a        │
                          │           GameModule per active room        │
                          └─────────────────────────────────────────────┘
```

The server is a single Node process running `ws` behind Caddy on the Ubuntu
mini PC. Caddy terminates TLS and reverse-proxies the WSS upgrade straight
through — no separate API layer, no database. This must run cleanly on
modest hardware: one process, in-memory room/session state, no heavyweight
dependencies.

- **net** — WebSocket connections, message framing (`ClientMessage` /
  `ServerMessage`, see §3), heartbeats, and the session/reconnect layer
  (§5).
- **rooms** — the room manager: create/join/leave/kick, room codes,
  `RoomState` bookkeeping, host-only config actions.
- **host** — the game host runtime. One instance per active room, wrapping
  a single `GameModule` (§4) for that room's lifetime: calls `setup`,
  validates and applies `game.action`s via `currentActors` + `reduce`,
  computes per-player views, and fans out results.

The client is Three.js + TypeScript, structured as:

- **app** — bootstrap, WebSocket connection, lobby flow, mounting the
  active game's presenter.
- **ui** — 2D/DOM overlay (lobby screen, HUD, chat). Renders `RoomState`,
  never game rules.
- **table** — the shared 3D scene: renderer bootstrap, seat layout, the
  `PresenterCtx` (§6) that per-game presenters mount into.
- **camera** — the `CameraDirector` (§2). Knows nothing about any specific
  game.

## 2. The GameEvent stream — the seam that makes everything else work

`GameEvent` (§3) is the single channel through which a game module
communicates *what happened* to the outside world, and it is the load-bearing
design decision of this whole platform.

A game module emits a stream of semantic events — `{ type: 'piece.moved',
payload: {...}, focus: { target: { kind: 'seat', seat: 2 } } }` — as part of
every `reduce()` call. Each event *may* carry a `FocusHint`: a target (a
point, a scene object id, a seat, or "wide shot of the table"), an optional
dwell time, and a priority.

The client's `CameraDirector` consumes these focus hints and decides how the
camera moves — it knows nothing about checkers, poker, or Codewords. The game
module, symmetrically, knows nothing about cameras, easing curves, or shot
composition — it just says "this seat is where the interesting thing is
happening right now."

This one decoupling is what makes "the camera follows the action, then
returns to the local player's seat" work **generically, for all ~80
eventual games, with zero per-game camera code**. Game #4 through game #80
never write a single line that touches a camera. This is why the
`rules/presenter split` invariant (§7) is non-negotiable: the moment a game
module reaches into the camera or scene directly, this seam breaks and every
future game inherits the mess.

`private` on a `GameEvent` restricts delivery to specific players (e.g. "you
were just dealt this card" — nobody else's client receives that event at
all, not even in a redacted form). `actor` records who caused the event,
when relevant (e.g. for "so-and-so is thinking" UI).

## 3. The round trip

1. **Client → server**: the client sends `{ t: 'game.action', action:
   <game-defined> }`. Clients send *intents*, never state — the action is
   opaque to the protocol layer; only the specific `GameModule` knows how to
   interpret it.
2. **Server validates**: the host runtime checks the sender is one of
   `currentActors(state)` for the room's game, then calls `reduce(state,
   action, ctx)`. `ctx.actor` is the validated sender's `PlayerId`; `ctx.rng`
   is the room's injected `Rng` (§4) — never `Math.random()`.
3. **`reduce` returns**: `{ state, events }` — the new state and the list of
   `GameEvent`s that happened as a result. `reduce` throws `IllegalAction` on
   anything invalid (wrong actor already filtered by `currentActors`, but
   also malformed actions, out-of-turn attempts that slip through, illegal
   moves, etc). The server never applies a state it can't explain as the
   result of a valid `reduce()` call.
4. **Server fans out**: for each connected player, the server computes
   `view(state, playerId)` and sends `{ t: 'game.view', view, version }` (a
   full, idempotent snapshot — safe to render at any time, including on
   reconnect), plus `{ t: 'game.events', events, version }` — the subset of
   this turn's events that player is entitled to see (respecting each
   event's `private` field).
5. **Client renders**: `renderView(view)` on the room's `GamePresenter` does
   a full idempotent re-render from the latest view. `playEvent(ev)` is then
   called once per event in order, each one animating and resolving before
   the next starts; events also flow into the `CameraDirector` via their
   `focus` hints.
6. When `isTerminal(state)` becomes non-null, the server sends `{ t:
   'game.over', result }` instead of (or after) the last `game.view`.

`version` is a monotonically increasing per-room counter the host runtime
stamps on every `game.view`/`game.events` pair, so a client can detect a
missed message (e.g. after a reconnect) and know it needs a fresh
`game.view` rather than trying to reconcile.

## 4. Frozen contracts

**These are frozen. A change requires overseer approval — do not edit
`packages/protocol` or `packages/engine` unilaterally; if you believe a
change is required, stop and report it.**

The type shapes below are reproduced exactly as specified for A0. Their
canonical source is the actual `.ts` files under `packages/protocol/src` and
`packages/engine/src` — read this doc for the *why*, read the source for the
literal, current truth if the two ever appear to disagree (they shouldn't).

### §A — `packages/protocol` (wire types)

```ts
export type PlayerId = string;   // stable for the session
export type RoomId   = string;   // 4-char join code, unambiguous alphabet (no O/0/I/1)
export type GameId   = string;   // 'checkers' | 'holdem' | 'codewords' | ...

export interface PlayerPublic {
  id: PlayerId;
  username: string;
  seat: number;          // 0..n-1, position around the table
  connected: boolean;
  isHost: boolean;
  team?: number;         // team games only
}

export interface RoomState {
  id: RoomId;
  hostId: PlayerId;
  gameId: GameId | null;
  maxPlayers: number;
  players: PlayerPublic[];
  phase: 'lobby' | 'playing' | 'finished';
  startable: { ok: boolean; reason?: string };  // drives the host's Start button
}

export type ClientMessage =
  | { t: 'hello';        username: string; resumeToken?: string }
  | { t: 'room.create';  gameId: GameId; maxPlayers: number }
  | { t: 'room.join';    roomId: RoomId }
  | { t: 'room.leave' }
  | { t: 'room.kick';    target: PlayerId }                          // host only
  | { t: 'room.config';  gameId?: GameId; maxPlayers?: number }      // host only
  | { t: 'room.start' }                                              // host only
  | { t: 'game.action';  action: unknown }
  | { t: 'chat';         text: string }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'hello.ok';    playerId: PlayerId; resumeToken: string }
  | { t: 'error';       code: ErrorCode; message: string }
  | { t: 'room.state';  room: RoomState }
  | { t: 'game.view';   view: unknown; version: number }
  | { t: 'game.events'; events: GameEvent[]; version: number }
  | { t: 'game.over';   result: GameResult }
  | { t: 'chat';        from: PlayerId; text: string }
  | { t: 'pong' };

export type ErrorCode =
  | 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'NOT_HOST' | 'BAD_PLAYER_COUNT'
  | 'ILLEGAL_ACTION' | 'NOT_YOUR_TURN' | 'USERNAME_TAKEN' | 'RATE_LIMITED';
```

`protocol` also exports a trivial helper: `generateRoomId()`, which builds a
4-char code from the unambiguous alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
(no `O`/`0`/`I`/`1`). It takes an optional `random: () => number` for
deterministic callers; the default is `Math.random`, which is fine here
because this is a lobby/display helper, not game logic — the "no
`Math.random()`" invariant (§7) is scoped to game modules.

### §B — `packages/engine` (game contracts)

```ts
export interface Rng {
  int(maxExclusive: number): number;
  float(): number;
  shuffle<T>(items: T[]): T[];
}

export type FocusTarget =
  | { kind: 'point';  x: number; y: number; z: number }
  | { kind: 'object'; id: string }     // scene object id owned by the presenter
  | { kind: 'seat';   seat: number }
  | { kind: 'table' };                 // wide establishing shot

export interface FocusHint {
  target: FocusTarget;
  holdMs?: number;                     // dwell time; director may clamp
  priority?: 'low' | 'normal' | 'high';
}

export interface GameEvent {
  type: string;                        // game-defined, e.g. 'piece.moved'
  payload: unknown;
  focus?: FocusHint;
  actor?: PlayerId;
  private?: PlayerId[];                // if set, ONLY these players receive it
}

export interface GameMeta {
  id: GameId;
  title: string;                       // generic, non-trademarked
  minPlayers: number;
  maxPlayers: number;
  teams?: { count: number; minPerTeam: number };
  estMinutes?: number;
  summary: string;
}

export interface SetupCtx  { players: PlayerPublic[]; rng: Rng; options?: unknown }
export interface ReduceCtx { actor: PlayerId; rng: Rng }
export interface ReduceResult<S> { state: S; events: GameEvent[] }
export interface GameResult { winners: PlayerId[]; scores?: Record<PlayerId, number>; reason: string }

export interface GameModule<S = unknown, A = unknown, V = unknown> {
  meta: GameMeta;
  setup(ctx: SetupCtx): S;
  /** Throws IllegalAction on invalid input. Must be pure and deterministic given rng. */
  reduce(state: S, action: A, ctx: ReduceCtx): ReduceResult<S>;
  /** MUST strip everything viewer is not entitled to see. Enforced by test. */
  view(state: S, viewer: PlayerId): V;
  currentActors(state: S): PlayerId[];
  isTerminal(state: S): GameResult | null;
  /** Played on behalf of a disconnected/timed-out player. */
  defaultAction(state: S, player: PlayerId): A;
}
```

(`PlayerId`/`PlayerPublic`/`GameId` come from `@party/protocol` — import
them, do not redefine.)

`@party/engine` also exports:

- `createRng(seed: number): Rng` and the `Mulberry32Rng` class that backs
  it — deterministic, reproducibly seedable from a single number.
- `IllegalAction`, an `Error` subclass thrown by `reduce()` on invalid
  input.
- The game **registry**: `registerGame(id, module)`, `getGame(id)`,
  `listGames(): GameMeta[]`, `allGameIds(): GameId[]`. The registry is
  pre-populated with all three v1 ids (`checkers`, `holdem`, `codewords`)
  mapped to trivial stub `GameModule`s. Each game package (e.g.
  `packages/games/checkers`) calls `registerGame('checkers', realModule)`
  from its own entry file to overwrite its stub — this is a deliberate
  conflict-avoidance measure so implementing game N never means editing a
  shared registry file that every other game agent also touches.

### Package-layout note: where `GameEvent`/`FocusHint`/`FocusTarget`/`GameResult` actually live

The A0 brief's §B code block lists `GameEvent`, `FocusHint`, `FocusTarget`
and `GameResult` alongside the engine contracts. But `ServerMessage` (§A, in
`protocol`) also references `GameEvent` and `GameResult` directly. Since
`GameModule`/`GameMeta`/etc. (also in §B) already need `PlayerId`,
`PlayerPublic`, and `GameId` from `protocol`, having `protocol` depend back
on `engine` for `GameEvent`/`GameResult` would make the two packages depend
on each other — a circular package reference, which `tsc -b`'s project
references explicitly reject, and which would also violate `protocol`'s
"zero runtime deps" requirement (a dependency on `engine` is a real runtime
dependency, even if only types are used).

**Resolution**: `GameEvent`, `FocusHint`, `FocusTarget`, and `GameResult`
are defined in `@party/protocol` (`packages/protocol/src/events.ts`), and
`@party/engine` imports and **re-exports** all four from its own
`index.ts`. The dependency graph is a straight line — `protocol` (zero
deps) ← `engine` ← `server`/`client`/`games/*` — never circular. Everything
that imports `GameEvent`/`FocusHint`/`FocusTarget`/`GameResult` from
`@party/engine` (as the interfaces above imply you should be able to) keeps
working exactly as written; only the physical file each type is *declared*
in moved. The shapes themselves are unchanged from what's specified above.

## 5. Reconnect semantics

`hello.ok` issues a `resumeToken`. A client reconnecting within **90
seconds** sends that token back in its `hello` message and reclaims its
`PlayerId`, seat, and hand/private state. While disconnected, that player's
entry in `RoomState.players` shows `connected: false`; the game does not
advance past a disconnected player's turn until the timeout elapses, at
which point the host runtime calls that game's `defaultAction(state,
player)` and applies it via the normal `reduce()` path (so it's subject to
the exact same validation and event emission as a real action). This is not
enforced by the type system — it's a runtime contract for whichever wave
builds `net`/`host` (currently A1/A3) to implement.

## 6. The presenter contract (client side)

This does not need its own package yet — `packages/client` is a Wave 1
stub. A4/A5 will formalize this in `packages/client` once they land, but the
shape is fixed now so every later game (`packages/games/*`) can be written
against it:

```ts
export interface PresenterCtx {
  scene: THREE.Scene;
  table: THREE.Object3D;          // pieces parent to this
  seats: SeatLayout[];            // world transforms, index === seat number
  localSeat: number;
  assets: AssetLoader;
  camera: CameraDirector;
  emit(action: unknown): void;    // user intent -> server
}

export interface GamePresenter<V = unknown> {
  gameId: GameId;
  mount(ctx: PresenterCtx): Promise<void>;
  /** Idempotent full-state render. Must be safe to call at any time (reconnect, resize). */
  renderView(view: V): void;
  /** Animate one event. Resolves when the animation is finished. */
  playEvent(ev: GameEvent): Promise<void>;
  unmount(): void;
}
```

A presenter is the client-side counterpart to a `GameModule`: it turns
`view()` output into a 3D scene and `GameEvent`s into animation, and turns
player input into `emit()` calls carrying an `action`. A presenter must
never implement rules (no move validation, no win-condition checks — that
lives in `reduce`/`isTerminal`), and a `GameModule` must never import
`Three.js` — see §7.

## 7. Engineering invariants

These apply to every wave, not just A0:

- **`view(state, viewer)` must strip everything the viewer isn't entitled
  to see.** Hidden hands, face-down cards, an opponent's secret info — all
  of it must be genuinely absent from the returned view, not just hidden by
  client-side rendering. This will be checked later by an automated leak
  test (not built in A0 — `packages/engine/src/guards/` is reserved for it).
- **All randomness flows through an injected `Rng`.** No `Math.random()`
  anywhere in a game module (`packages/games/*`) or in `packages/engine`
  itself. `SetupCtx.rng` / `ReduceCtx.rng` are the only source of
  randomness a game may use — this is what makes games replayable and
  testable headlessly.
- **A game that is built but not registered/reachable from the lobby is
  not done.** Implementing a `GameModule` isn't enough — it must be
  registered (`registerGame`) and actually selectable from the client's
  lobby flow.
- **Rule modules must not import Three.js; presenters must not implement
  rules.** This split is what makes rules testable headlessly (pure
  functions over plain data, run in Vitest with no browser/DOM) and is the
  same split that lets the `CameraDirector` (§2) stay generic across ~80
  games.
- **Server-authoritative, always.** Clients send intents (`game.action`
  with an opaque `action` payload); the server is the only thing that ever
  calls `reduce()` and the only thing that decides what state is. A client
  never computes or trusts its own copy of game state beyond the last
  `game.view` it received.
- **No trademarked game titles, no reproduced third-party content.** This
  repo is public. `GameMeta.title` must be generic (e.g. "Codewords", not
  the trademarked word-association game it's inspired by). Third-party
  assets must be CC0 or original, and recorded in `/ASSETS.md`.

## 8. Build/CI conventions

- **npm workspaces** (not pnpm/yarn), Node 26+, `"type": "module"`
  everywhere.
- **ESM + `NodeNext` module resolution.** Relative imports within a
  package's `src/` must include an explicit `.js` extension (e.g. `import
  './rng.js'` from a file named `rng.ts`) — this is required by
  `NodeNext`'s Node-compatible ESM resolution and matches how the compiled
  output actually runs under `node`. Cross-package imports (`@party/engine`
  from `packages/server`) resolve via each package's `package.json`
  `exports`/`main`/`types` fields and need no extension.
- **TypeScript project references.** Each package's `tsconfig.json` is
  `composite: true` and lists its workspace dependencies under
  `references`. The root `tsconfig.json` is a references-only "solution"
  file. `tsc -b tsconfig.json` builds the whole graph in dependency order —
  this is what both `just typecheck` and `just build` run (see the comment
  in `justfile` for why they're the same underlying command).
- **`just verify`** runs `install → typecheck → test → build → e2e`, in
  that exact order, and this must always match `.github/workflows/ci.yml`'s
  step list byte-for-byte. If you add, remove, or reorder a check in one,
  make the identical change to the other in the same commit.
- **Stub packages** (everything under §1 marked "STUB ONLY" in the A0
  brief) must stay minimal until the wave that owns them: a compiling
  package.json + tsconfig.json + one small entry file. Do not build real
  behaviour into a stub ahead of its wave — that's how two agents end up
  editing the same file.
