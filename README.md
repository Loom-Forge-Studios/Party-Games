# Party Games

A self-hosted website where friends set a username, create or join a lobby,
and play board/card/party games rendered in 3D around a shared virtual
table.

Set a username, create a room (or join one with a friend's room code), pick
a game, hit start, and you're both looking at the same table — checkers
pieces, poker cards, or a Codewords key — rendered live in the browser with
Three.js. The server is the only thing that ever decides what happened; the
3D view is just a window onto it, so reconnecting or opening the game in a
second tab always shows the real, current state.

**Status**: v1 is playable end to end — real server, real client, real
camera, and three real games (Checkers, Texas Hold'em, Codewords), each with
real rules and a real 3D presenter.

## Quick start

Requires **Node.js 26+** and npm (npm workspaces — not pnpm/yarn). Every
command below is run from the repo root.

```sh
git clone https://github.com/Loom-Forge-Studios/Party-Games.git
cd Party-Games
npm install        # or: just install
npm run build      # or: just build — compiles every package's dist/, see note below
npm run dev        # starts the server (:8080) AND the Vite client (:5173) together
```

Then open **http://localhost:5173** in two browser tabs (or send the second
one to a friend on your network). In each tab: type a username and continue,
then in one tab create a room (pick a game and player count) and in the
other tab enter that room's 4-character code to join. Once everyone's in,
the host clicks **Start game** and both tabs mount the same 3D table.

> **Why the build step first:** every package (`@party/protocol`,
> `@party/engine`, `@party/presenter`, each game, the server) is a normal
> TypeScript project-reference package that imports its workspace
> dependencies from their compiled `dist/` output (see
> [docs/ARCHITECTURE.md §8](docs/ARCHITECTURE.md#8-buildci-conventions)). A
> completely fresh clone has no `dist/` yet, so the server and the client's
> dev-time dependency pre-bundling both fail until something has run
> `tsc -b` once. `npm run build` / `just build` does that. After the first
> build, `npm run dev` picks up further changes fine on its own (the server
> runs under `tsx watch`, and Vite serves the client's TypeScript directly)
> — you only need to re-run `build` if you change a package *other than the
> one you're actively iterating on* and want the compiled `dist/` other
> packages resolve against to catch up.

This exact sequence — clone, `npm install`, `npm run build`, `npm run dev`,
open `http://localhost:5173`, create a room, join with the code — was run in
this environment while writing this README and produced a connected lobby
with a real room code (see screenshot note below).

`npm run dev` runs `npm run dev --workspace=@party/server` and
`npm run dev --workspace=@party/client` concurrently:

- **Server** (`packages/server`): a single Node process, `ws` mounted at
  `/ws`, a health check at `/healthz`, default port `8080` (override with the
  `PORT` env var).
- **Client** (`packages/client`): Vite dev server on port `5173`. Its dev
  proxy forwards `/ws` (websocket) and `/healthz` straight through to the
  server on `8080`, so the browser only ever talks to `5173` — same as
  production, where Caddy does the equivalent reverse-proxying (see
  [ops/](ops/)).

### Useful environment variables

- `PORT` — server listen port (default `8080`).
- `SERVER_SEED` — when set, every room's game is seeded deterministically (a
  fixed base plus an incrementing counter per room) instead of from
  `Date.now()`. Not for normal play; it exists so end-to-end tests get
  reproducible game outcomes. See
  `packages/server/src/host/host-manager.ts`'s `HostManagerOptions.seed` doc
  comment.

### Screenshot

_A screenshot placeholder — no image file is committed here._ This session
did drive a real browser against a real `npm run dev` and got as far as a
connected lobby screen (username entered, room created, a real 4-character
room code, "Players (1/2)", a Start game button disabled until a second
player joins) — but the browser-automation tool used to verify this doesn't
expose a way to save its screenshots to disk, so there was nothing to commit
as a real file rather than fake. Drop a real PNG at `docs/screenshot.png`
and swap this section for a normal `![Party Games lobby](docs/screenshot.png)`
once you have one.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the real, as-built system:
  protocol/engine contracts, the client's table/camera/presenter split, the
  `@party/presenter` package, the lobby→table wiring, dev workflow, build/CI
  conventions.
- [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md) — step-by-step recipe for
  adding a new game to the platform. Start here if that's your task.
- [ASSETS.md](ASSETS.md) — third-party asset provenance/licensing (CC0 or
  original only — this repo is public).

## House conventions

- **TypeScript everywhere**, `"type": "module"`, Node 26+. ESM + `NodeNext`
  module resolution: relative imports within a package's `src/` use an
  explicit `.js` extension (e.g. `import './rng.js'` from `rng.ts`).
- **npm workspaces** (not pnpm/yarn) — see the `workspaces` array in the
  root [package.json](package.json). Each package under `packages/*` is a
  normal npm workspace *and* a TypeScript
  [project reference](https://www.typescriptlang.org/docs/handbook/project-references.html)
  (`composite: true`, listed under the root `tsconfig.json`'s `references`);
  `tsc -b tsconfig.json` builds the whole dependency graph in order.
- **Vitest** for unit tests (`npm test` / `just test` — runs every
  `packages/**/src/**/*.test.ts`, no per-package registration needed, see
  [vitest.config.ts](vitest.config.ts)) and **Playwright** for end-to-end
  browser tests (`packages/e2e` workspace, run via `just e2e`).
- **`justfile` mirrors CI byte-for-byte.** `just verify` runs
  `install → typecheck → test → build → e2e`, in that exact order, and
  `.github/workflows/ci.yml` runs the identical `just <step>` calls in the
  identical order. If you add, remove, or reorder a check in one, make the
  same change to the other in the same commit — see the invariant comment
  at the top of the [justfile](justfile). `just verify` is what should be
  green locally before you push; it's slower than `npm run dev` (it
  reinstalls, typechecks, tests, builds, and runs the full Playwright e2e
  suite) but it's the one command whose result actually predicts CI.
- **Server-authoritative, always.** Clients send intents, never state; only
  the server ever calls a game's `reduce()`. See
  [docs/ARCHITECTURE.md §7](docs/ARCHITECTURE.md#7-engineering-invariants)
  for the full list of engineering invariants (hidden-info view filtering,
  injected `Rng` only, rules/presenter split, etc).

## License

MIT — see [LICENSE](LICENSE).
