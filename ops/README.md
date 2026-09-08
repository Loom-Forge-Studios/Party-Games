# ops

STUB ONLY — owned by A13 (later wave). Not an npm workspace.

Will hold deployment tooling for the Ubuntu mini PC target: a Caddy
reverse-proxy config (TLS termination, WSS upgrade to the `@party/server`
process), a systemd unit (or equivalent) to keep the server running and
restart on failure, and a deploy script. Keep it lightweight — this runs on
modest hardware, so no container orchestration, no reverse-proxy-in-front-
of-reverse-proxy layering.

Do not build real behaviour here outside of the wave that owns it.
