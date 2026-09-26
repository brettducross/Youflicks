# SG routing operations

PR-8 decides a treatment. It does not call a paid provider by itself, and it does not render Ken Burns (that processor is PR-9).

## Mode

`SG_ROUTING_MODE` is optional. When it is unset, the only default is `DEFAULT_SG_ROUTING_MODE` in `src/server/sg/routing-mode.ts`, which is `LEGACY`.

LEGACY is a temporary exception while the product is internal: the live R1 lane (`LEGACY_R1`, Wan via Replicate) may still serve, and E-R1 is not a launch decision. Set `SG_ROUTING_MODE=ENFORCED` before any invite or hosted flip. Flip that constant, or set the env var. Callers do not need a restructure.

Dialogue close-ups are not generated in either mode. Until E12 is decided they are ORIGINAL when original media covers the slot, otherwise DEFER.

## Restart

The lane resolver is cached on the service container for the life of the process. There is no hot reload. A registry file change, `SG_LANES_SUSPENDED`, or a lane gateway env change is picked up on the next process start. Restart the app after those changes. Restart each gateway process after its own `YF_GATEWAY_LANE_ID` or backend env changes.

## Host allowlist

`assertHttpBaseUrl` allows `http` and `https` and refuses userinfo. It does not yet block loopback, link-local, or metadata hosts, because local tests and the current operator-set gateway URL use `127.0.0.1`. If `baseUrl` is ever taken from somewhere other than operator env, refuse link-local, metadata, and loopback addresses, and require `https` for a hosted gateway. That allowlist is not enforced in this PR.
