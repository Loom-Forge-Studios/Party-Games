# Deploying Party-Games — Ubuntu mini PC runbook

This deploys the whole platform (Node game server + static Three.js client)
behind Caddy, with automatic Let's Encrypt TLS, using Docker Compose. It
assumes a fresh Ubuntu box (22.04/24.04 — anything with a recent-enough
kernel for Docker) with a public IP, sitting on your home network or a VPS.

Two containers, both built from [`ops/Dockerfile`](./Dockerfile) (see that
file's own comments for the build): `app` (the game server, not reachable
from outside the box directly) and `caddy` (TLS termination, static file
serving, reverse proxy — the only thing that binds 80/443). See
[`ops/docker-compose.yml`](./docker-compose.yml) and
[`ops/Caddyfile`](./Caddyfile) for the full config; this doc is the
step-by-step.

## 1. DNS

Point an A record (and AAAA, if the box has a public IPv6 address) at the
box's public IP:

```
games.yourdomain.com.   A       203.0.113.42
```

Use whatever registrar/DNS provider you already have. Let's Encrypt (which
Caddy uses automatically — see step 4) needs this to already be resolving
correctly before you bring the stack up, or certificate issuance will fail.
Propagation can take a few minutes to a few hours depending on the
provider/TTL; `dig +short games.yourdomain.com` from another machine is the
quickest way to confirm it's live.

## 2. Open ports 80 and 443

Caddy needs both: 80 for the ACME HTTP-01 challenge (and to redirect
plain-HTTP visitors to HTTPS), 443 for the actual TLS traffic (including the
WebSocket connection, which rides the same HTTPS port — there's no separate
port to open for `/ws`).

- **Cloud VM / VPS**: open 80/443 in the provider's security group /
  firewall rules.
- **Home network**: port-forward 80 and 443 on your router to the mini PC's
  LAN IP, and if the box runs `ufw`:
  ```
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  ```

## 3. Install Docker

```
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
```

Log out and back in (or `newgrp docker`) for the group change to take
effect. Docker Compose v2 ships as the `docker compose` subcommand with any
current Docker install — no separate `docker-compose` binary to install.

## 4. Clone the repo and set DOMAIN

```
git clone https://github.com/Loom-Forge-Studios/Party-Games.git
cd Party-Games
cp ops/.env.example ops/.env
$EDITOR ops/.env    # set DOMAIN=games.yourdomain.com
```

`DOMAIN` is what [`ops/Caddyfile`](./Caddyfile) uses both as the site it
serves and as the domain it requests a Let's Encrypt certificate for —
automatic HTTPS is Caddy's default behavior for any real domain name, no
extra TLS config needed. `docker compose` auto-loads `ops/.env` because it
sits next to `ops/docker-compose.yml`.

If you skip this step, the stack still comes up (Caddy falls back to
`localhost` with a locally-trusted, not publicly valid, certificate — see
the comment at the top of `ops/Caddyfile`), which is useful for a quick
local smoke test but not what you want for a real deployment reachable from
the internet.

## 5. Bring it up

```
docker compose -f ops/docker-compose.yml up -d --build
```

First run builds both images (a few minutes — it compiles the whole
TypeScript workspace and the Vite client bundle inside the build stage, see
`ops/Dockerfile`); after that, plain `docker compose -f ops/docker-compose.yml up -d`
is enough unless the code has changed.

Check both containers came up and stayed up (not crash-looping):

```
docker compose -f ops/docker-compose.yml ps
```

You want `Up ... (healthy)` for `app` and `Up` for `caddy`, not `Restarting`.
Then confirm from outside the box:

```
curl https://games.yourdomain.com/healthz
# -> ok
```

and open `https://games.yourdomain.com/` in a browser — you should get the
lobby. First TLS handshake may take a few extra seconds while Caddy
completes the ACME issuance in the background.

### Verified before opening the PR

Ran on a clean checkout of this branch (`docker compose -f
ops/docker-compose.yml build`, then `up -d` with `DOMAIN` unset — exercising
the `localhost` self-signed-CA fallback path since there's no real public
domain available in this sandbox):

- both images build successfully (`runtime` and `caddy` targets)
- `docker compose ps` shows `app` **healthy** and `caddy` running, no
  restarts, for the life of the check
- `GET /healthz` through Caddy → app returns `ok`, HTTP 200
- `GET /` through Caddy serves the built client `index.html`, HTTP 200
- a real WebSocket upgrade to `/ws` through Caddy succeeds (`101 Switching
  Protocols`), and a `{"t":"hello",...}` message sent over it gets a real
  `{"t":"hello.ok",...}` back from the game server — i.e. this isn't just
  the HTTP-level proxy working, the actual game protocol round-trips
  through Caddy's TLS termination end to end.
- idle memory: `app` ~21MB / 256MB limit, `caddy` ~17MB / 128MB limit (see
  "Resource limits" below for where those limits come from)

One real bug was caught and fixed by this: `ops/Caddyfile`'s `/healthz` and
`/ws` routes were initially being silently swallowed by the static-file
fallback (`try_files` runs before `reverse_proxy` in Caddy's fixed directive
order, regardless of the order they're written in the file) — `/healthz`
was returning the client's `index.html` instead of the app's `ok`. Fixed
with explicit `handle` blocks; see the comment in `ops/Caddyfile`.

## 6. Where the logs live

```
docker compose -f ops/docker-compose.yml logs -f          # both services
docker compose -f ops/docker-compose.yml logs -f app       # game server only
docker compose -f ops/docker-compose.yml logs -f caddy     # TLS/proxy only
```

These are container stdout/stderr, captured by Docker's own log driver —
nothing writes to a file on the host by default. If you want them to
survive `docker compose down` / persist longer than Docker's default log
rotation, that's a Docker daemon logging-driver setting
(`/etc/docker/daemon.json`), not something this compose file configures.

## 7. Updating

```
cd Party-Games
git pull
docker compose -f ops/docker-compose.yml up -d --build
```

`--build` rebuilds the images only if something changed (Docker layer
caching); Compose recreates only the containers whose image actually
changed, so a client-only or server-only change doesn't bounce the
connection nobody touched. Existing WebSocket connections to a
container being replaced are dropped — see "Backups" below for why that's
acceptable here (players just reconnect; there's no state to lose).

## 8. Backups / restore

**There is nothing to back up.** v1 has no database and no persistent
storage — `RoomState` and all game state live entirely in the `app`
container's memory (see `docs/ARCHITECTURE.md` §1: "one process, in-memory
room/session state"). Restarting the `app` container ends every in-progress
lobby; there's no data file, volume, or external store to snapshot. The
only two named volumes in `ops/docker-compose.yml` (`caddy-data`,
`caddy-config`) hold Caddy's own TLS certificate cache, not application
data — losing them just means Caddy re-issues a certificate from Let's
Encrypt on next start (rate-limited if you do this too often in a short
window, but otherwise harmless).

If a later wave adds persistent storage (accounts, stats, anything that
should survive a restart), this section needs a real backup procedure at
that point — don't invent one now for state that doesn't exist yet.

## 9. Pointing a real domain at it (summary)

This is steps 1, 2, and 4 together: A record → the box's public IP, ports
80/443 reachable from the internet, `DOMAIN` set in `ops/.env` to that same
domain. Caddy handles certificate issuance and renewal automatically from
there — nothing to run manually, no cron job, no certbot.

---

## Resource limits

Set in [`ops/docker-compose.yml`](./docker-compose.yml) under each
service's `deploy.resources`:

| service | memory limit | memory reservation | CPU limit | CPU reservation |
|---|---|---|---|---|
| `app`   | 256M | 128M | 1.0 | 0.25 |
| `caddy` | 128M |  32M | 0.5 | 0.10 |

Reasoning (not a benchmark — see the caveat under "Concurrent-lobby
ceiling" below, and the verification run in step 5 above, which measured
actual idle usage on this build):

- **`app` memory.** Node's own baseline (V8 heap + the `ws` server) idles
  well under 100MB — measured ~21MB on this build with zero connections.
  Everything else this process holds is in-memory `RoomState`/game-state
  for whatever lobbies are currently open, which is small: a `RoomState` is
  a handful of players with short string fields (§A in
  `docs/ARCHITECTURE.md`), and per-game state (checkers board, poker hand,
  Codewords grid) is at most a few KB. 256MB is generous headroom above the
  idle baseline for a self-hosted friend-group service — not a number
  picked to match a specific lobby count, but big enough that a genuine
  handful of concurrent games doesn't come close to it, while still being
  small enough to fail fast (OOM-kill, auto-restart via `restart:
  unless-stopped`) rather than let a leak (e.g. a bug that never cleans up
  a disconnected session) slowly starve the rest of the box.
- **`app` CPU.** This process relays small JSON messages between
  WebSocket connections and calls a game's `reduce()` on each action — I/O-
  bound, not compute-bound. 1.0 CPU limit is generous; the 0.25
  reservation just guarantees it isn't starved if something else on the
  box is busy. A sustained flood large enough to matter is exactly what
  `RATE_LIMITED` (`docs/ARCHITECTURE.md` §A's `ErrorCode`) exists to
  reject at the application layer, not something to size more CPU around.
- **`caddy` memory/CPU.** Caddy itself idles under 40MB (measured ~17MB
  here) and the static bundle it serves is a handful of small files (no
  checked-in image/video/audio assets — see `ASSETS.md`); TLS termination
  for a friend-group-scale audience is not CPU-heavy. 128MB/0.5 CPU is
  headroom, not a tight fit.

If you're deploying on something smaller than a typical mini PC (a
Raspberry Pi, say), these are conservative enough that halving them would
likely still be fine — but that's also unmeasured; watch `docker stats`
after a real game or two and adjust if you see sustained pressure against
a limit.

## Concurrent-lobby ceiling (estimate, not a measurement)

**This is reasoning from message size/frequency and connection overhead,
not a load test against real hardware** — this environment can't benchmark
an actual Ubuntu mini PC. Treat it as a starting estimate to validate with
`docker stats` once it's running for real, not a guarantee.

Assumptions:
- A "mini PC" here means something in the Intel N100 / similar low-power
  class: 4 cores, 8-16GB RAM, of which this stack is allotted the limits
  above (384MB combined, well under 1GB) — the rest of the box's RAM is
  free for the OS and anything else running on it.
- Games are turn-based / display-paced (Checkers, Hold'em, Codewords per
  `docs/ARCHITECTURE.md`'s v1 scope) — not a twitch/real-time genre. Message
  frequency per player is on the order of one action every few seconds at
  most during active play, not a continuous stream.
- Each `game.view`/`game.events` message (§3 of `docs/ARCHITECTURE.md`) is
  small JSON — state for a board/hand/grid game, not media — plausibly
  1-10KB serialized, fanned out to each seat (typically 2-8 players per
  room per `GameMeta.minPlayers`/`maxPlayers`).
- Each open WebSocket connection costs the OS a socket + Node a modest
  fixed object overhead (tens of KB, not MB) — `ws` doesn't buffer large
  amounts of data per idle connection.

Working from those: bandwidth is trivial even at a few hundred connections
(a few hundred connections × a few messages/second × a few KB is well
under 10 Mbps, nowhere near even a modest home uplink's ceiling), and the
256MB `app` memory budget divided among lobby/session objects that are
individually tens-to-low-hundreds of KB leaves room for on the order of
hundreds of concurrent connections before memory is the binding
constraint. The more likely practical ceiling on genuinely modest hardware
is CPU during simultaneous burst activity (many rooms' actions landing at
once) and Node's single-threaded event loop, not raw connection count.

**Estimate: comfortably tens of concurrent lobbies (call it up to ~50) —
i.e. low hundreds of concurrent players — on a mini PC before you'd want to
actually measure and reconsider**, for a friend-group-scale self-hosted
deployment (this is not sized or intended for a public/viral audience).
Given the CPU limit above, if you ever expect sustained heavier concurrency
than that, the first lever is raising `app`'s CPU limit in
`ops/docker-compose.yml` (memory has more headroom already) — the second is
a proper load test against real hardware; this estimate is a starting
point for that test, not a substitute for it.
