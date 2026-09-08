# Party-Games — multi-stage build, three targets from one Dockerfile.
#
# Build context is the REPO ROOT (see ops/docker-compose.yml's
# `build.context: ..`), because this is an npm-workspaces monorepo: the
# server's runtime deps (@party/protocol, @party/engine) are sibling
# workspace packages, not published npm packages, so the build needs the
# whole packages/ tree to resolve them.
#
# Targets (selected via docker-compose.yml's `build.target`):
#   build   — not run standalone; shared base the other two COPY --from.
#             Full devDependencies, compiles every workspace (tsc -b) and
#             the client's static bundle (vite build), then prunes back to
#             production-only node_modules in place.
#   runtime — the `app` service. node:26-alpine, nothing but the compiled
#             dist/ for the three packages the server actually needs
#             (protocol, engine, server) plus their production
#             node_modules. No TypeScript, no .ts source, no
#             devDependencies.
#   caddy   — the `caddy` service. Official Caddy image plus the compiled
#             static client bundle baked in at /srv/client-static and this
#             repo's Caddyfile. Baking the static files into the image
#             (rather than a shared docker volume synced at container
#             start) means there's no ordering/permission dance between the
#             two containers — the files are just part of the image.

# ---- stage: build -----------------------------------------------------------
FROM node:26-alpine AS build
WORKDIR /app

# Workspace manifests first so `npm ci` is cached unless a package.json or
# the lockfile actually changed (source edits below don't bust this layer).
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY e2e ./e2e

# Installs devDependencies too (needed for tsc/vite) — pruned below. This
# installs every workspace's deps, not just the server's; see the "prune"
# comment further down for why that's fine.
RUN npm ci

# `npm run build` (root) = `tsc -b tsconfig.json`: builds packages/protocol,
# packages/engine, packages/assets, packages/server, packages/client (types
# only) and packages/games/* in dependency order. This is the SAME command
# `just build` / CI run — see docs/ARCHITECTURE.md §8.
RUN npm run build

# The client's static bundle is a separate concern from its `tsc -b` type
# build above (see packages/client/vite.config.ts's comment on why
# build.outDir is "dist-web", not "dist" — tsc already owns "dist"). This is
# the one build step that isn't already part of the root `build`/`verify`
# pipeline; it exists so this Dockerfile can produce something Caddy can
# serve as static files.
RUN npm run build --workspace=@party/client

# Drop devDependencies (typescript, vitest, playwright, tsx, vite, jsdom,
# ...) from node_modules in place, keeping only what package.json
# "dependencies" (not devDependencies) declare across every workspace — in
# practice just `ws` (server) and `three` (client/assets, unused at
# runtime but left in place rather than hand-pruning per-workspace, which
# would mean re-deriving npm's own workspace dependency resolution by hand
# inside this Dockerfile; the extra few MB on disk costs nothing at
# runtime since the server process never imports it).
RUN npm prune --omit=dev

# ---- target: runtime (the `app` service) -------------------------------------
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Production node_modules (workspace packages are symlinks into ./packages/*
# — e.g. node_modules/@party/engine -> ../packages/engine — which is why the
# three package.json + dist pairs below are copied to the same relative
# paths used in the build stage: the symlinks must resolve to something
# real).
COPY --from=build /app/node_modules ./node_modules

COPY --from=build /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist

COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/engine/dist ./packages/engine/dist

COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist

RUN addgroup -S party && adduser -S party -G party && chown -R party:party /app
USER party

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "packages/server/dist/index.js"]

# ---- target: caddy (the `caddy` service) -------------------------------------
FROM caddy:2-alpine AS caddy

COPY --from=build /app/packages/client/dist-web /srv/client-static
COPY ops/Caddyfile /etc/caddy/Caddyfile
