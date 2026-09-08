# Party Games — Architecture

This document is self-contained: every later agent reads this instead of any
external planning doc. If something you need to know isn't here, that's a
gap worth reporting, not a reason to guess.

**A note on vintage.** Most of this document was written during Wave 0/1, as
the original design brief, before any of Wave 2's three games or the
client's real 3D scene existed. It has been kept accurate since — the
protocol/engine contracts in §4 are still frozen and unchanged — but two
pieces of real, as-built structure were added by the overseer *after* Wave 2
landed, once dynamically loading a per-game presenter turned out to create a
circular package dependency the original plan hadn't anticipated: the
`@party/presenter` package (§6) and the client's lobby→table mounting glue
(§9). If you're looking for "where do I import `PresenterCtx` from" or "how
does a game actually get on screen", §6 and §9 are the current truth; the
rest of this document (§1-§5, §7, §8) describes the original design, still
accurate.

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

- **app** — bootstrap, WebSocket connection, lobby flow, and the
  lobby→table handoff that mounts the active game's presenter (`table-mount.ts`
  + `game-presenters.ts` — see §9, added by the overseer after Wave 2).
- **ui** — 2D/DOM overlay (lobby screen, HUD, chat). Renders `RoomState`,
  never game rules.
- **table** — the shared 3D scene: renderer bootstrap, seat layout, the
  `PresenterCtx` factory (§6) that per-game presenters mount into.
- **camera** — the `ThreeCameraDirector` implementation of `CameraDirector`
  (§2, §6). Knows nothing about any specific game.

Below `@party/client` in the dependency graph sits **`@party/presenter`**
(`packages/presenter`) — a small leaf package added after Wave 2 holding the
`PresenterCtx`/`CameraDirector`/`SeatLayout`/`GamePresenter` *type contracts*
(and a couple of small utilities). See §6 for why it exists and where it
sits in the package graph.

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

## 6. The presenter contract (client side) — canonical source is `@party/presenter`

**This section was originally written against a Wave-1 stub `packages/client`
and said the contract "doesn't need its own package yet." That's no longer
true — read this section, not the original brief, for where these types
actually live.**

The shape below is unchanged from what Wave 0 specified — no game presenter
written against it needs to change — but its physical home moved. When the
overseer wired the client to dynamically `import()` each game's presenter
(§9), `@party/client` started depending on every `packages/games/*` package
(to know what to dynamically import and to typecheck the result). Each game
package, in turn, already depended on `@party/client` for `PresenterCtx` and
friends (Wave 2 games were built in parallel worktrees against a Wave-1
`packages/client` stub). That's a circular TypeScript project reference
(`client → games/* → client`), which `tsc -b` refuses to build.

**Resolution**: a small leaf package, **`@party/presenter`**
(`packages/presenter`), now holds *only* the type contracts every
presenter — the client's own table/camera code, and every game's
`presenter.ts` — needs: `PresenterCtx`, `CameraDirector`, `SeatLayout`,
`CameraPose`, `GamePresenter`, plus the table geometry constants
(`TABLE_RADIUS`, `TABLE_HEIGHT`, `TABLE_SURFACE_Y`) and a couple of small DOM
utilities. It has **no dependency on `@party/client`**. The dependency graph
is now a straight line — `@party/protocol`/`@party/engine`/`@party/assets` ←
`@party/presenter` ← both `@party/client` *and* every `packages/games/*`
package — never circular. `@party/client` still re-exports everything from
its old locations (`table/index.ts`, `camera/index.ts`) for source
compatibility with any Wave 1/2 code that imported from there, and it
*implements* the contracts (`ThreeCameraDirector`, `createPresenterCtx`,
`computeSeatLayout`); it does not redefine them.

**When writing a new game's `presenter.ts`, import these types from
`@party/presenter`, never from `@party/client`.** Importing from
`@party/client` from a game package is exactly the circular edge this
package exists to avoid re-introducing — see
[docs/ADDING_A_GAME.md](ADDING_A_GAME.md).

```ts
// packages/presenter/src/index.ts — canonical source; read the file for
// full doc comments on each member.
export interface CameraPose {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export interface CameraDirector {
  focus(hint: FocusHint): Promise<void>;   // ease toward the hint, dwell, ease back home
  home(): Promise<void>;                   // ease back to the local player's seat pose
  setHome(pose: CameraPose): void;         // sets the pose 'home' eases back to
  snap(): void;                            // immediate cut, no easing
}

export interface SeatLayout {
  seat: number;                            // 0..n-1, seats[i].seat === i always
  position: { x: number; y: number; z: number };
  rotationY: number;
  avatar: THREE.Object3D;
  cameraPose: CameraPose;
}

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
  editing the same file. (Historical note: as of this writing every package
  has landed its real implementation — there are no remaining stubs. This
  rule stays here for the shape of any future wave that adds a genuinely
  new stub package.)

## 9. Client wiring: lobby → table → mounted presenter

Added by the overseer after Wave 2, in
`packages/client/src/app/table-mount.ts` and
`packages/client/src/app/game-presenters.ts`. Neither file was owned by a
single Wave 1/2 agent — `index.html`'s bootstrap call and `app/index.ts`'s
own header comment both say so explicitly: wiring the lobby→table handoff
to an actual mounted 3D presenter is deliberately a cross-cutting
integration step, done once the pieces it wires together (A4's lobby flow,
A5's 3D scene/`PresenterCtx` factory, A6's camera director, and Wave 2's
three game presenters) all existed.

**`game-presenters.ts`** is a `GameId -> GamePresenter` dynamic loader:

```ts
const LOADERS: Record<GameId, Loader> = {
  checkers: async () => {
    const mod = await import('@party/game-checkers/presenter');
    return new mod.CheckersPresenter();
  },
  holdem: async () => { /* ... */ },
  codewords: async () => { /* ... */ },
};
```

It exists for two reasons: each of Wave 2's three games exposes its
presenter differently (a class, a singleton, a factory function — see each
game's own `presenter.ts`), so this is the one place that difference is
absorbed instead of every call site knowing about it; and the loader uses a
dynamic `import()` per game id so mounting one game's presenter doesn't pull
all three games' Three.js code into a session that only ever plays one.

**This hardcoded map is the one place a new game must be wired in by
hand** — nothing here (or in `packages/server/src/index.ts`, see below)
iterates `packages/games/*` automatically. Forgetting this step is the most
common way "I implemented a `GameModule` and a presenter" fails to become
"the game is actually playable" — see
[docs/ADDING_A_GAME.md](ADDING_A_GAME.md), which calls this out as its own
step for exactly that reason.

**`table-mount.ts`** exports `mountTable(opts)`, called once per
lobby→table transition (when `RoomState.phase` becomes `'playing'`). It:

1. Builds the `<canvas>`, a `THREE.PerspectiveCamera`, and the renderer into
   the container `index.html` reserves for the 3D view.
2. Constructs a `ThreeCameraDirector` and, via `createPresenterCtx`
   (`packages/client/src/table/presenter-ctx.ts`), the full `PresenterCtx`
   for this room — seat layout computed from the room's player count and the
   local player's seat, `emit` wired to `connection.send({ t: 'game.action',
   action })`.
3. Runs a render loop continuously for as long as a table is mounted
   (documented in the file as a deliberate trade-off: `CameraDirector` eases
   poses on its own internal `requestAnimationFrame` loop but the frozen
   contract gives it no "something changed, please redraw" hook, so this
   trades the idle-frame battery optimization for guaranteed-correct
   rendering during camera moves).
4. Calls `loadGamePresenter(room.gameId)` and `presenter.mount(ctx)`.
5. Subscribes to the connection's incoming messages and forwards them to
   the mounted presenter exactly as §3 "the round trip" specifies:
   `game.view` → `presenter.renderView(view)`; `game.events` → each event's
   `presenter.playEvent(ev)` awaited in order (so one event's animation, and
   any camera move it triggers, finishes before the next starts — matching
   `playEvent`'s documented contract); `game.over` → a DOM banner overlay
   with the winner(s)/reason (not part of the 3D scene — this is the one
   place the app layer, not a presenter, reacts to `game.over`).
6. Returns a `MountedTable` whose `unmount()` tears all of the above down —
   call it before mounting again (e.g. leaving one game's table to start
   another).

Nothing in this file implements game rules or camera behaviour; it only
wires already-built pieces together and forwards server messages.

## 10. Dev workflow

`npm run dev` from the repo root (see the root `package.json`'s `dev`
script) runs **both** of these concurrently, and waits on both:

- `npm run dev --workspace=@party/server` — `tsx watch src/index.ts`. Listens
  on `PORT` (default `8080`), `ws` mounted at `/ws`, health check at
  `/healthz`. `tsx watch` restarts the process on any source change under
  `packages/server`.
- `npm run dev --workspace=@party/client` — `vite`. Dev server on port
  `5173`, serving the client's TypeScript directly (no separate build step
  needed for client-only changes). Its dev proxy
  (`packages/client/vite.config.ts`) forwards `/ws` (as a websocket) and
  `/healthz` to `http://localhost:8080`, so the browser only ever talks to
  `5173` — the same shape as production, where Caddy reverse-proxies WSS to
  the Node process (§1) instead of Vite doing it.

**A completely fresh clone needs one `npm run build` (or `just build`)
before `npm run dev` will work.** Every package resolves its workspace
dependencies through compiled `dist/` output (via each package's
`package.json` `main`/`types`/`exports` fields — see §8), and a fresh
checkout has no `dist/` yet: the server fails immediately with
`ERR_MODULE_NOT_FOUND` for `@party/protocol/dist/index.js`, and Vite's
dependency pre-bundling fails to resolve `@party/presenter` /
`@party/protocol` for the same reason. Running the build once populates
every package's `dist/`, after which `npm run dev` behaves as you'd expect
for iterative work (this was verified in this environment: a completely
fresh `npm install` and `npm run dev` reproduced both errors above; running
`npm run build` first and then `npm run dev` brought up a real server on
`:8080` and a real client on `:5173` that connected to it).

**`SERVER_SEED`** (env var, unset by default): when set, `packages/server`'s
`HostManager` seeds each room's game deterministically — a fixed base seed
(the env var's value) plus an incrementing per-room counter — instead of
`Date.now()`. This exists specifically so end-to-end (Playwright) tests can
assert on actual game outcomes instead of just "something happened
without crashing". See `packages/server/src/index.ts`'s `seedEnv`/`seedOpt`
handling and `packages/server/src/host/host-manager.ts`'s
`HostManagerOptions.seed` doc comment. Not meant to be set for normal/
production play — every room would otherwise start from the same
deterministic sequence, which is exactly the opposite of what real games
want.
