# ops

Owned by A13. Deployment tooling for the Ubuntu mini PC target.

- [`Dockerfile`](./Dockerfile) — multi-stage build (compile stage, then a
  slim `runtime` target for the app and a `caddy` target with the static
  client bundle baked in). See the file's own header comment for the full
  layout.
- [`docker-compose.yml`](./docker-compose.yml) — the `app` service (built
  from `Dockerfile`'s `runtime` target) and a `caddy` service (TLS
  termination, static file serving, reverse proxy — built from the same
  `Dockerfile`'s `caddy` target), with resource limits sized for modest
  hardware.
- [`Caddyfile`](./Caddyfile) — automatic Let's Encrypt TLS for `${DOMAIN}`,
  reverse-proxies `/ws` (with WebSocket upgrade headers) and `/healthz` to
  the app, serves the static client build for everything else.
- [`.env.example`](./.env.example) — copy to `.env` and set `DOMAIN`.
- [`DEPLOY.md`](./DEPLOY.md) — the actual runbook: DNS, ports, cloning,
  bringing it up, logs, updates, and why there's no backup procedure (v1
  has no persistent data).

Run it with `docker compose -f ops/docker-compose.yml up -d` — see
`DEPLOY.md` for the full sequence. No systemd unit: containers +
`restart: unless-stopped` cover "keep it running / restart on failure"
without a second layer of process supervision on top of Docker's own.
