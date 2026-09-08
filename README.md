# Party Games

A self-hosted website where friends set a username, create or join a lobby,
and play board/card/party games rendered in 3D around a shared virtual
table.

This is a minimal stub README written during A0 (foundation scaffolding).
The real README is A14's job in a later wave.

- Architecture, contracts, and conventions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Third-party asset provenance/licensing: [ASSETS.md](ASSETS.md)
- Task runner: `just --list` (see [justfile](justfile))
- License: MIT (see [LICENSE](LICENSE))

## Quick start

```sh
just install
just verify   # install -> typecheck -> test -> build -> e2e, same as CI
just dev      # run the server in watch mode
```
