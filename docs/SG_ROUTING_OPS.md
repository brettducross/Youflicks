# SG routing operations

PR-8 decides a treatment. It does not call a paid provider by itself, and it does not render Ken Burns (that processor is PR-9).

## Mode

`SG_ROUTING_MODE` is optional. When it is unset, the only default is `DEFAULT_SG_ROUTING_MODE` in `src/server/sg/routing-mode.ts`, which is `LEGACY`.

The default routing mode and any hosted flip await PO decision E-R1 (pending). That constant is a working default only. Flip the constant, or set `SG_ROUTING_MODE`, without restructuring callers.

Dialogue close-ups are not generated in either mode. Until E12 is decided they are ORIGINAL when original media covers the slot, otherwise DEFER. A generated dialogue or talking-face treatment remains a possible later E12 decision and would need a further lock amendment.

## Ceilings

Escalation moves at most one class above the start class. When any non-cap attempt exists, the start class is the lowest class that holds one of those attempts. Current health and suspension do not move that start. An empty class is never skipped: the next class is only the immediate neighbor, even when that neighbor has no qualified healthy lane. That is stricter than a reading that jumps to the next class that currently has a lane.

## Suspension

`SG_LANES_SUSPENDED` ids are case-sensitive. `Hero-Lane` does not match `hero-lane`. An id that does not match a lane or processor exactly is unknown and raises `SG_LANES_SUSPENDED_UNKNOWN`. That alert is debounced for 60 seconds per unknown-id set.

## Gateway model

A live gateway returns 409 `MODEL_LANE_MISMATCH` before it reserves when the request model differs from the registry lane `modelId`. Check `YF_GATEWAY_MODEL` against that lane before deploy. The response does not echo either value.

## Restart

The lane resolver is cached on the service container for the life of the process. There is no hot reload. A registry file change, `SG_LANES_SUSPENDED`, or a lane gateway env change is picked up on the next process start. Restart the app after those changes. Restart each gateway process after its own `YF_GATEWAY_LANE_ID` or backend env changes.

## Host allowlist

`assertHttpBaseUrl` allows `http` and `https` and refuses userinfo. It does not yet block loopback, link-local, or metadata hosts, because local tests and the current operator-set gateway URL use `127.0.0.1`. If `baseUrl` is ever taken from somewhere other than operator env, refuse link-local, metadata, and loopback addresses, and require `https` for a hosted gateway. That allowlist is not enforced in this PR.

## Budget

Project and user cap flags passed to the policy come from the budget ledgers. There is no separate global or per-lane ledger, so those two flags stay clear. The reservation is still the exact price check, and an ENFORCED hold is booked from the routed lane's quote before `forLane`.
