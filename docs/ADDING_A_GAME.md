# Adding a game

This is a step-by-step recipe for adding a new game to Party Games —
written for an agent (or a person) with **zero prior context** on this
codebase beyond having this file and [docs/ARCHITECTURE.md](ARCHITECTURE.md)
open. If a step below assumes something it hasn't told you yet, that's a bug
in this doc — fix it once you find it.

**This recipe was validated by actually following it**: a trivial fixture
game ("Fixture Flip" — a two-player coin-flip race, no real gameplay value)
was scaffolded end to end using exactly the steps below, and `npm run
typecheck`, `npm test`, and `npm run build` all passed clean on the first
try. It was then deleted — it never shipped — but every step below reflects
what actually worked, not a guess.

## 0. The mental model, in one paragraph

A game is two things that never touch each other: a **rules module**
(`GameModule` — pure data in, pure data out, no rendering, no `Math.random`)
and a **presenter** (turns the rules module's output into a 3D scene and
turns player clicks into server messages). The server only ever runs the
rules module; the client only ever runs the presenter. The one channel
between "what happened" and "what the camera/scene should do about it" is
the `GameEvent` stream each `reduce()` call returns — see
[docs/ARCHITECTURE.md §2](ARCHITECTURE.md#2-the-gameevent-stream--the-seam-that-makes-everything-else-work),
which is worth reading in full before you write a single line, along with
§3 ("the round trip"), §4 (the frozen `GameModule`/`GamePresenter` type
shapes), §6 (where those presenter types actually live —
**`@party/presenter`, not `@party/client`**), and §7 (the non-negotiable
invariants: no `Math.random`, `view()` must strip hidden info, rules must
never import Three.js).

## 1. Copy an existing game package as your template

Don't start from a blank package — copy one of the three real ones under
`packages/games/`. **Start with Checkers** (`packages/games/checkers/`) —
it's the simplest of the three (turn-based, two players, no hidden
information, no betting/side-pot math), so it's the smallest working
example of every piece you need. Hold'em and Codewords are worth reading
afterward for patterns Checkers doesn't need: Hold'em for multi-way betting
state and hand evaluation; Codewords for hidden-information `view()`
filtering (its `view-filtering.test.ts` is the reference for that pattern —
see step 6).

```sh
cp -r packages/games/checkers packages/games/<your-game-id>
rm -rf packages/games/<your-game-id>/dist   # if a stray build output got copied
```

Then rewrite every file inside `packages/games/<your-game-id>/src/` for your
actual game — copying the template is a starting *shape*, not something you
keep board/move logic from unless your game genuinely is checkers-like.

## 2. `package.json` and `tsconfig.json`

Both files need small, mechanical edits — copy the pattern, don't
freehand it:

**`packages/games/<your-game-id>/package.json`**: rename `"name"` to
`@party/game-<your-game-id>` (this exact string is what everything else
below imports), update `"description"`, and keep the `"exports"` map's two
entries as-is (only the paths change if your presenter file is named
something other than `presenter.ts`, which it shouldn't be):

```json
{
  "name": "@party/game-<your-game-id>",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./presenter": { "types": "./dist/presenter.d.ts", "default": "./dist/presenter.js" }
  },
  "dependencies": {
    "@party/engine": "*",
    "@party/presenter": "*",
    "@party/protocol": "*",
    "three": "^0.186.0"
  }
}
```

The `"."` export is the rules-only entry point (safe to import from a plain
Node process — no Three.js pulled in); `"./presenter"` is the client-only
entry point. This split exists so `packages/server/src/index.ts` (step 7)
can import your game for its `registerGame()` side effect without pulling
Three.js into the server process. Add `"@party/assets": "*"` too if your
presenter imports anything concrete from `@party/assets` directly (e.g. the
procedural card/meeple constants) rather than just going through
`ctx.assets.load(key)` on the `PresenterCtx` it's handed.

**`packages/games/<your-game-id>/tsconfig.json`**: identical shape to every
other game's, just check the relative `references` paths still resolve
(three `../../` hops up to `packages/`, since your package is two levels
deep under `packages/games/`):

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "references": [{ "path": "../../protocol" }, { "path": "../../engine" }, { "path": "../../presenter" }]
}
```

## 3. Register the package with npm workspaces and TypeScript's project references

Two files at the **repo root**, both mechanical one-line additions:

- **`package.json`**'s `"workspaces"` array — add
  `"packages/games/<your-game-id>"` (order doesn't matter; match the
  existing games' alphabetic-ish grouping if you like).
- **`tsconfig.json`**'s `"references"` array — add
  `{ "path": "packages/games/<your-game-id>" }`.

Without the second one, `tsc -b` won't know your package needs building as
part of the whole-repo build graph, and other packages that depend on it
(step 7) will fail to resolve its type declarations.

After both edits, run `npm install` once from the repo root so npm
symlinks the new workspace into `node_modules/@party/game-<your-game-id>`
— every cross-package import (`@party/engine`, and later
`@party/game-<your-game-id>` from the client/server) resolves through that
symlink, not a relative path.

## 4. Implement the `GameModule` (rules — `module.ts`)

This is the file that must **never import Three.js** (see
[docs/ARCHITECTURE.md §7](ARCHITECTURE.md#7-engineering-invariants)) and
must implement, against `@party/engine`'s frozen `GameModule<S, A, V>`
contract ([docs/ARCHITECTURE.md §4B](ARCHITECTURE.md#b--partyengine-game-contracts)):

```ts
export interface GameModule<S, A, V> {
  meta: GameMeta;
  setup(ctx: SetupCtx): S;
  reduce(state: S, action: A, ctx: ReduceCtx): ReduceResult<S>;
  view(state: S, viewer: PlayerId): V;
  currentActors(state: S): PlayerId[];
  isTerminal(state: S): GameResult | null;
  defaultAction(state: S, player: PlayerId): A;
}
```

Working through them in the order you'll actually write them:

- **`setup(ctx)`** — build your initial `S` from `ctx.players` (seat 0..n-1)
  and `ctx.rng`. Validate player count/seating here and throw
  `IllegalAction` (from `@party/engine`) on anything that shouldn't be
  possible (wrong player count, missing seats).
- **`reduce(state, action, ctx)`** — the one function that ever changes
  state. `ctx.actor` is the already-validated sender (the host runtime
  checked they're in `currentActors(state)` before calling this — you still
  must check it's actually *their* turn/move/action, since `currentActors`
  can return more than one actor at once for simultaneous-action games).
  Parse and validate `action` defensively (it arrives as `unknown` over the
  wire) and throw `IllegalAction` with a specific message on anything
  malformed or illegal — never silently no-op. Return `{ state, events }`.
  **Every event that moves, reveals, or resolves something should carry a
  `FocusHint`** (`{ target, holdMs?, priority? }`) — this is what makes the
  camera follow the action instead of sitting still; see
  [docs/ARCHITECTURE.md §2](ARCHITECTURE.md#2-the-gameevent-stream--the-seam-that-makes-everything-else-work)
  and Checkers' `pointFocus()` helper for the pattern (a `{ kind: 'point',
  x, y, z }` target computed from your board's own layout math, or `{ kind:
  'seat', seat }` when the interesting thing is a player's own action rather
  than a board location). When the game ends, also push a `game.over` event
  with a `{ kind: 'table' }` wide-shot focus and a generous `holdMs` so the
  result is legible.
- **`view(state, viewer)`** — must **actually strip** anything `viewer`
  isn't entitled to see (opponent's hand, unrevealed card colours, etc.) —
  not just omit it from the UI. If your game has no hidden information
  (like Checkers), this can just be a structural copy of `state`. If it
  does, see Codewords' `view-filtering.test.ts` for the reference pattern
  and step 6 for the test class this needs.
- **`currentActors(state)`** — whose action(s) `reduce` will currently
  accept; return `[]` once the game is terminal (this is also what the host
  runtime uses to know nobody can act anymore).
- **`isTerminal(state)`** — returns a `GameResult` (`{ winners, scores?,
  reason }`) or `null`. **Must never disagree with what `reduce()` itself
  decided** when it pushed a `game.over` event — factor the actual
  win/draw-condition check into one shared helper both call, the way
  Checkers' `computeResult()` is used by both.
- **`defaultAction(state, player)`** — the action played on `player`'s
  behalf after the 90-second reconnect window elapses (see
  [docs/ARCHITECTURE.md §5](ARCHITECTURE.md#5-reconnect-semantics)). Must
  always return *something* legal for the current state — a random legal
  move is fine; throwing here would leave a disconnected player able to
  wedge the whole game.

Route **all** randomness through `ctx.rng` / `SetupCtx.rng` — a
`float()`/`int(maxExclusive)`/`shuffle(items)` interface backed by a
seedable Mulberry32 PRNG (`createRng(seed)` from `@party/engine`). Never
call `Math.random()` anywhere in this file — that's what makes the
determinism test (step 6) and `SERVER_SEED`-based E2E reproducibility
(docs/ARCHITECTURE.md §10) possible at all.

Finally, `index.ts` is the **only** file that calls `registerGame()`:

```ts
import { registerGame } from '@party/engine';
import { yourGameModule } from './module.js';

registerGame('<your-game-id>', yourGameModule);

export default yourGameModule;
export { yourGameModule, /* ...any types other files need... */ } from './module.js';
```

**Never edit `packages/engine/src/registry.ts` directly** — it's a shared
file every game agent would otherwise collide on; calling `registerGame()`
from your own package's `index.ts` is the entire point of the registry
existing (it pre-populates every known game id with a trivial stub module
so nothing crashes before your real one is registered).

## 5. Implement the `GamePresenter` (3D view — `presenter.ts`)

This is the **only** file in your package allowed to import Three.js. It
implements `@party/presenter`'s frozen `GamePresenter<V>` — **import
`PresenterCtx` and `GamePresenter` from `@party/presenter`, never from
`@party/client`.** This is not a stylistic preference: a game package that
imports from `@party/client` re-creates the exact circular
`client → games/* → client` project-reference cycle `@party/presenter` was
carved out specifically to break — `tsc -b` will refuse to build it. See
[docs/ARCHITECTURE.md §6](ARCHITECTURE.md#6-the-presenter-contract-client-side--canonical-source-is-partypresenter)
for the full story of why this package exists.

```ts
export interface GamePresenter<V = unknown> {
  gameId: GameId;
  mount(ctx: PresenterCtx): Promise<void>;
  renderView(view: V): void;   // idempotent full-state render — safe at any time (reconnect, resize)
  playEvent(ev: GameEvent): Promise<void>;   // animate one event; resolves when done
  unmount(): void;
}
```

`PresenterCtx` hands you `scene`/`table` (parent your meshes to `table`, not
`scene`, directly), `seats` (world transforms — `seats[i].seat === i`),
`localSeat`, `assets` (an `AssetLoader` — `assets.load(key)` never rejects,
falling back to a placeholder primitive), `camera` (a `CameraDirector` —
call `camera.focus(hint)` from inside `playEvent` when the event carries a
`FocusHint`, and let it resolve before your own animation's promise
resolves if the two should be simultaneous — see Checkers'
`Promise.all([focusPromise, animPromise])` pattern), and `emit(action)` (the
one way input reaches the server — never call anything else that sends
network messages from here).

Rules to keep in mind, all straight from
[docs/ARCHITECTURE.md §7](ARCHITECTURE.md#7-engineering-invariants):

- **No move validation, no win-condition checks here.** If you find
  yourself writing "is this move legal" logic in the presenter, it either
  belongs in `module.ts`, or (client-side legal-move *highlighting*, purely
  for UX, is fine — see Checkers' click-to-select code — as long as the
  server is still the one that actually validates the resulting
  `game.action`).
- `renderView()` must be safe to call repeatedly and at any time — it's
  called on every `game.view`, including reconnects, so it should fully
  reflect `view` from scratch each time (create-or-update meshes by a stable
  id, remove ones no longer present) rather than assuming it's an
  incremental diff from the previous call.
- `playEvent()` should resolve only once its animation (and any
  `camera.focus()` it triggered) has actually finished — the app layer plays
  events strictly in order, awaiting each one before starting the next (see
  [docs/ARCHITECTURE.md §9](ARCHITECTURE.md#9-client-wiring-lobby--table--mounted-presenter)),
  so a `playEvent` that resolves too early makes animations overlap
  incorrectly, and one that never resolves stalls every event after it.

## 6. Wire the new game into the running platform

**This is the step most likely to get skipped, and a game that's only
half-wired is not done** — implementing a `GameModule` and a
`GamePresenter` is necessary but not sufficient; per
[docs/ARCHITECTURE.md §7](ARCHITECTURE.md#7-engineering-invariants), "a game
that is built but not registered/reachable from the lobby is not done."
None of the three files below iterate `packages/games/*` automatically —
each one is a small, currently-hardcoded, hand-maintained list of exactly
the existing games, and yours has to be added to **all three** by hand:

1. **`packages/client/src/app/game-presenters.ts`** — add an entry to the
   `LOADERS` record, keyed by your game id, dynamically importing your
   package's `"./presenter"` export:

   ```ts
   '<your-game-id>': async () => {
     const mod = await import('@party/game-<your-game-id>/presenter');
     return new mod.YourGamePresenterClass(); // or however your package exposes it — see the existing three for the "class vs singleton vs factory" variations this file already absorbs
   },
   ```

   This is a *dynamic* `import()` deliberately — so a session that only
   ever plays one game doesn't pull every game's Three.js code into its
   bundle. It still needs a normal, static project reference for `tsc -b`
   to typecheck the result (next bullet).

2. **`packages/server/src/index.ts`** — add a side-effect import next to
   the other three:

   ```ts
   import '@party/game-<your-game-id>';
   ```

   This is what actually calls your `registerGame()` (step 4) at server
   startup, overwriting the registry's do-nothing stub for your game id. No
   import here means the server keeps running the built-in stub forever,
   even though your real rules module compiles and its tests pass.

3. **`packages/client/package.json`** and **`packages/client/tsconfig.json`**
   — add `"@party/game-<your-game-id>": "*"` (or a pinned version, matching
   the other three's `^0.1.0` style) to the client's `dependencies`, and
   `{ "path": "../games/<your-game-id>" }` to its `tsconfig.json`
   `references`. `packages/client` already depends on every game package
   (that's *why* `@party/presenter` had to be extracted — see step 5 and
   ARCHITECTURE.md §6) — this just extends that existing, intentional
   one-directional edge (`client → games/*`, never the other way) to your
   new package. Without this, `tsc -b` can compile your game package on its
   own but fails once it tries to build the client, which imports it.

Then re-run `npm install` from the repo root (workspace/reference changes
in steps 3 and here need it to re-symlink and let `tsc -b` see the new
project references).

**A fourth place, not part of the frozen wiring above but needed for a
player to ever *choose* your game from the UI**:
`packages/client/src/app/games.ts`'s `FALLBACK_GAMES` array is what the
lobby's "Create a room" game selector actually renders (see that file's own
header comment — it's a temporary stand-in for a real "list games" protocol
message that doesn't exist yet, hardcoded to mirror the three real games'
`GameMeta`). Add a `{ id, title, minPlayers, maxPlayers }` entry matching
your `GameModule.meta` here too, or your game will register and run
correctly but never appear as selectable in a real browser session.

## 7. The four required test classes

Every game package needs, at minimum, tests in these four classes (spread
across as many `*.test.ts` files as makes sense — Vitest picks up every
`packages/**/src/**/*.test.ts` automatically, no registration needed, see
[vitest.config.ts](../vitest.config.ts)). Look at the existing games' test
files for the closest precedent to your game's shape:

1. **Game-specific edge cases** — whatever your rules' hardest corner is.
   For Checkers this is multi-jump-chain-style state: forced continuation
   with the same piece, promotion ending a chain immediately even if the
   new king could jump again, forced-capture-must-be-taken. Your game has
   its own version of this — the state transition that's easy to get subtly
   wrong (a betting round's side-pot math, a simultaneous-reveal tie,
   whatever). Write it as its own `describe` block, ideally against a
   hand-built minimal state (see Checkers' `customState()` helper) rather
   than only ever testing from a fresh `setup()`.
2. **Hidden-information `view()` filtering, if applicable** — skip this
   class entirely if your game has no hidden information (Checkers doesn't:
   its `view()` test just confirms both players get the identical full
   board). If it does, follow Codewords'
   `view-filtering.test.ts`: assert the *serialized* view for a
   non-privileged viewer never contains a value it shouldn't (not "the UI
   doesn't render it" — the actual returned object must not carry it, "not
   even as a substring" per that file's own test names), and that once
   something becomes public (a revealed card, a folded hand) every viewer's
   view reflects that.
3. **Determinism** — play a full game (`setup` → repeatedly `reduce` via
   your own `defaultAction` as a deterministic stand-in "AI" for every
   actor, until `isTerminal` is non-null) twice from the same seed, and
   assert the final state, result, and full event history are
   `JSON.stringify`-identical. See Checkers'
   `describe('checkersModule — full-game determinism')` for the exact
   pattern (including a `guard` loop-count ceiling so a bug that makes the
   game never terminate fails the test instead of hanging it). This is what
   actually proves "no stray `Math.random()`" rather than just asserting it
   by code review.
4. **Terminal conditions** — every distinct way `isTerminal()` can return
   non-null (a normal win, a resignation/no-legal-moves loss, a draw
   condition if your game has one), plus: `currentActors()` returns `[]`
   once terminal, and `reduce()` itself throws `IllegalAction` if called
   again after the game is already over.

A presenter test file (smoke-level: mount/renderView/playEvent/unmount
against a hand-built fake `PresenterCtx`, entirely in Node — `three`'s core
object graph works fine without a real WebGL context, see any existing
game's `presenter.test.ts`) is expected too, though it wasn't one of the
four required classes above.

## 8. Verify

```sh
npm run typecheck   # or: just typecheck — tsc -b across the whole graph, catches steps 2/3/6 mistakes fast
npm test            # or: just test — every package's Vitest suite, including your new one
npm run build       # or: just build — same command as typecheck; see justfile's comment on why
```

Then `just verify` (the full `install → typecheck → test → build → e2e`
sequence CI runs) before opening a PR — see the [README](../README.md)'s
house-conventions section and the invariant comment at the top of the
[justfile](../justfile).

For a real, in-browser check: `npm run build` once (fresh clone needs
this — see
[docs/ARCHITECTURE.md §10](ARCHITECTURE.md#10-dev-workflow)), then
`npm run dev` from the repo root, open two tabs at `http://localhost:5173`,
create a room with your new game selected (step 6's `games.ts` entry is
what makes it selectable) and join it from the second tab — you should see
your presenter's 3D scene mount in both tabs once the host starts the game.

## Checklist

- [ ] `packages/games/<your-game-id>/` — copied from Checkers, rewritten
      (`module.ts`, `presenter.ts`, `index.ts`, plus board/helper files as
      needed and test files)
- [ ] `package.json` — `"name"`, `"description"`, `"exports"` (`.` and
      `./presenter`)
- [ ] `tsconfig.json` — `references` to `protocol`/`engine`/`presenter`
- [ ] Root `package.json` `"workspaces"` — new package added
- [ ] Root `tsconfig.json` `"references"` — new package added
- [ ] `module.ts` implements `GameModule` fully; no `Math.random`; no
      Three.js import; events carry `FocusHint`s
- [ ] `index.ts` calls `registerGame()` — nothing edits `registry.ts`
      directly
- [ ] `presenter.ts` implements `GamePresenter` against `@party/presenter`
      (not `@party/client`); no rules logic
- [ ] `packages/client/src/app/game-presenters.ts` — `LOADERS` entry added
- [ ] `packages/server/src/index.ts` — side-effect import added
- [ ] `packages/client/package.json` + `tsconfig.json` — dependency +
      reference added
- [ ] `packages/client/src/app/games.ts` — `FALLBACK_GAMES` entry added (so
      it's actually selectable from the lobby)
- [ ] All four required test classes present and passing
- [ ] `npm run typecheck` / `npm test` / `npm run build` (or `just verify`)
      all green
- [ ] Manually verified in two browser tabs
