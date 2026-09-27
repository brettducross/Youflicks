# PO Decision Record: SG E-R1 (default routing mode)

- Decision owner: Brett Ducross (YouFlicks Product Owner)
- Decided: 2026-09-26, 07:20 PT, in the Chief of Staff chat, in answer to E-R1 as re-raised after the Architect's PR-8 r4 APPROVE.
- Recorded by: Chief of Staff (verbatim transcription only; no added policy).

## PO answer (verbatim)

> "LEGACY for now, switch to ENFORCED before invites. Merge PR-8."

## Effect

1. `DEFAULT_SG_ROUTING_MODE` stays `LEGACY` (as merged in PR-8 #37, main `0cc5cf4`).
2. Switching the default to `ENFORCED` is a required gate before any human invites (Wave 1 ops invite checklist). The switch itself is a separate, reviewed change.
3. Nothing else changes: lock r3 (`16ea2660…`), CSV (`b187fc0a…`), PO decision 2026-09-25 (`d1517954…`) and registry `sg-lanes-v1` (`06601e8f…`) are unaffected. LAUNCH_GATE stays on HOLD. No provider is enabled for paid generation.

## Source trail

- PR-8 #37 squash commit `0cc5cf4cafa5bc901c54bfa366b48ae13f1b4c75` message records E-R1.
- Architect PR-9 review (`ARCH_REVIEW_SG_PR9_2026-09-26.md`, sha256 6d5d4615…) asked for this repo record and flagged stale "pending" text at `.env.example:103`, `docs/SG_ROUTING_OPS.md:9`, `routing-mode.ts:4-5`, `constants.ts:92` (SF-7), to be updated to reference this record.
