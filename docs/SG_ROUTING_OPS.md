# SG routing operations

PR-8 decides a treatment. It does not call a paid provider by itself. PR-9 renders Ken Burns or a static hold when `yf.kenburns.v1` is configured. The shipped registry leaves that processor disabled.

## Mode

`SG_ROUTING_MODE` is optional. When it is unset, the only default is `DEFAULT_SG_ROUTING_MODE` in `src/server/sg/routing-mode.ts`, which is `LEGACY`.

E-R1 decided 2026-09-26: LEGACY for now; ENFORCED before invites. See `docs/wave0-wave1/PO_SG_E-R1_ROUTING_MODE_DECISION_2026-09-26.md`. That constant is the only default. Do not add a second default. Switching to ENFORCED is a separate reviewed change required before invites. Flip the constant, or set `SG_ROUTING_MODE`, without restructuring callers.

Dialogue close-ups are not generated in either mode. Until E12 is decided they are ORIGINAL when original media covers the slot, otherwise DEFER. A generated dialogue or talking-face treatment remains a possible later E12 decision and would need a further lock amendment.

## Ceilings

Escalation moves at most one class above the start class. The start class is the lower of the lock start and the lowest historical non-cap class that is QUALIFIED or SUSPENDED for the current scopes. The lock start is draft-cost for NON_IDENTITY, and the lowest class that holds a lane QUALIFIED for every required scope for HERO or IDENTITY. Health does not move that start. An unhealthy start-class lane is not selected and does not jump to a pricier class. Suspension does move the start, because a suspended gate is not QUALIFIED. History is used alone only when no class is qualified, and it can pin the start lower, never higher. Picking a lane inside the start class, and escalating one class, still require a QUALIFIED, healthy lane. An empty class is never skipped: the next class is only the immediate neighbor, even when that neighbor has no qualified healthy lane. That is stricter than a reading that jumps to the next class that currently has a lane.

## Suspension

To take a lane out temporarily, suspend it (`SG_LANES_SUSPENDED`) rather than de-qualify it. Suspension overlays SUSPENDED only onto gates that are already QUALIFIED. A NOT_QUALIFIED gate stays NOT_QUALIFIED, so a suspended non-identity lane does not pin an identity start. De-qualification changes the lock start and is not a temporary hold.

`SG_LANES_SUSPENDED` ids are case-sensitive. `Hero-Lane` does not match `hero-lane`. An id that does not match a lane or processor exactly is unknown and raises `SG_LANES_SUSPENDED_UNKNOWN`. That alert is debounced for 60 seconds per unknown-id set.

## Gateway model

A live gateway returns 409 `MODEL_LANE_MISMATCH` before it reserves when the request model differs from the registry lane `modelId`. Check `YF_GATEWAY_MODEL` against that lane before deploy. The response does not echo either value.

## Restart

The lane resolver is cached on the service container for the life of the process. There is no hot reload. A registry file change, `SG_LANES_SUSPENDED`, or a lane gateway env change is picked up on the next process start. Restart the app after those changes. Restart each gateway process after its own `YF_GATEWAY_LANE_ID` or backend env changes.

## Host allowlist

`assertHttpBaseUrl` allows `http` and `https` and refuses userinfo. It does not yet block loopback, link-local, or metadata hosts, because local tests and the current operator-set gateway URL use `127.0.0.1`. If `baseUrl` is ever taken from somewhere other than operator env, refuse link-local, metadata, and loopback addresses, and require `https` for a hosted gateway. That allowlist is not enforced in this PR.

## Messages

Users see the applied key's copy per role in the Missing pieces panel. Shadow decisions are never shown. Ken Burns/static clips appear after a Rebuild cut.

## Budget

Project and user cap flags passed to the policy come from the app budget ledgers. Global and per-lane caps live on the gateway spend ledgers (`yf-asset` and `lane:<laneId>`) and are enforced when the gateway reserves (429 before the backend call, lock L181 and L280). A read-side pre-check of those ledgers was not landed with the ops sweep: failing closed when the ledger row is missing would deny the first job before the gateway creates it. The app reservation is still the project and user price check, and an ENFORCED hold is booked from the routed lane's quote before `forLane`.

App holds and the live gateway both estimate with `expectedLaneCharge` (`D_bill × usdPerSecond`). When `YF_GATEWAY_BACKEND_INPUT_JSON` contains a numeric `duration`, that value is the shared requested duration on the app and on the gateway process. When it does not, both sides use the lane `clipDurationS`. Do not set `duration` on the gateway to a different length than the app estimate: generate-time receipt verify compares echoed `laneId`, `modelId`, `usdPerSecond`, `estimatedBilledSeconds`, and `reservedUsd` to the hold and fails closed. It does not rewrite the hold to match the gateway. A mismatch found before the provider call releases the hold. A mismatch after the provider may already have been called leaves the hold `UNRECONCILED` (counted) unless the gateway settlement is an explicit `RELEASED` or `NONE`. The ops reconciliation flag is unchanged and still audits historical rows.

## Ops hygiene

`POST /api/ops/sg/hygiene` with `Authorization: Bearer $BETA_OPS_SECRET` runs three substeps and returns JSON. A missing or wrong secret is 404, the same as the other ops routes. The bearer compare is timing-safe.

1. Aged `UNRECONCILED` app holds. Default age is 24h (`SG_UNRECONCILED_SWEEP_MIN_AGE_MS`), floor 1h. Release only when the linked gateway reservation is `RELEASED` (definitive non-billable, including `CAP_DENIED`). Reconcile only when that row is `RECONCILED` and `actualBilledSeconds` is finite and >= 0. Otherwise the hold stays `UNRECONCILED`, still counted, and is listed (id, age, settleReason, laneId, estimatedUsd). A `TIMEOUT_UNRECONCILED` attempt on a hold this sweep releases or reconciles is rewritten to `FAILED`, with actuals copied from the hold when the hold reconciled. `SUCCEEDED` is used only when that attempt already points at a READY asset. The sweep does not start a generate.
2. Stale `RESERVED` holds. Default age is 2h (`SG_STALE_RESERVED_SWEEP_MIN_AGE_MS`), floor 30 minutes. A hold with no linked attempt and no PENDING or RUNNING job is released with reason `STALE_RESERVED`. No actuals are written and nothing is metered. A PENDING attempt, a running job, or any linked attempt is kept.
3. Meter backfill inserts `sg:AI_VIDEO_SECONDS:<holdId>` for `RECONCILED` holds with `actualBilledSeconds` > 0 that are missing the usage row. A second run does not insert a duplicate.

`GET /api/ops/sg/lanes` adds `openExposure` and `reconciliationFlags`. Open exposure is every `RESERVED` or `UNRECONCILED` app hold grouped by lane, at any age, including holds with no attempt. Money is the hold's estimate. Reconciliation flags compare the attempt's laneId and modelId to the gateway reservation. Both model ids null is not a mismatch. A missing gateway row is an unresolved link. The flag is not written back onto the attempt.
