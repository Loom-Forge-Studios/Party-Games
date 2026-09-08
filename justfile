# Party-Games task runner.
#
# INVARIANT: the `verify` recipe's step list (install, typecheck, test,
# build, e2e — in that exact order) and .github/workflows/ci.yml's step list
# MUST stay byte-for-byte in sync. If you add/remove/reorder a check in one,
# make the identical change to the other, in the same commit. This applies
# to every future wave too, not just A0 — CI is the source of truth for
# "is the tree green", and `just verify` exists so that answer is available
# locally before you push.

default:
    @just --list

# Install workspace dependencies (npm workspaces — not pnpm/yarn).
install:
    npm ci

# TypeScript project-reference build in --noEmit-equivalent form: `tsc -b`
# resolves cross-package types (e.g. @party/engine importing @party/protocol)
# by building each referenced project's .d.ts output, so this necessarily
# emits to each package's dist/. `build` (below) re-runs the identical
# command; TS's incremental build info makes that second run a fast no-op
# unless something changed between the two steps.
typecheck:
    npx tsc -b tsconfig.json

# Unit tests (Vitest) across every package.
test:
    npx vitest run

# Emits dist/ for every package. See the comment on `typecheck` above for
# why this is the same underlying command.
build:
    npx tsc -b tsconfig.json

# End-to-end tests (Playwright). Installs the browser binary first since a
# fresh checkout / fresh CI runner won't have it cached.
e2e:
    npx playwright install --with-deps chromium
    npm run e2e --workspace=@party/e2e

# Run the server in watch mode for local development.
dev:
    npm run dev --workspace=@party/server

# The exact sequence CI runs, in the exact same order. Green here means
# green in CI (modulo machine differences).
verify: install typecheck test build e2e
