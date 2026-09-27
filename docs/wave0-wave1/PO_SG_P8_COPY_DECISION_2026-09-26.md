# PO Decision Record: SG P-8 Q1 and Q6 (PR-10 user-facing copy)

- Decision owner: Brett Ducross (YouFlicks Product Owner)
- Decided: 2026-09-26, 22:48 PT, in the YouFlicks Architect chat, in answer to the Architect's P-8 Q1/Q6 recommendations from the PR-10 handoff review (`ARCH_REVIEW_SG_PR10_HANDOFF_2026-09-26.md`, sha256 c28201a6…).
- Recorded by: Chief of Staff (verbatim transcription only; no added policy).

## PO answer (verbatim)

Approve both recommended PR-10 wording changes.

### 1. Never claim a fallback that did not occur

Use:

> “we used your photo instead”

ONLY when an actual source photo was used as the fallback.

When no fallback media was used, use the honest waiting/failure language:

> “waiting for a clip — your movie can still be built without it”

or the appropriate equivalent from the approved copy.

Do not imply a substitute was used when it was not.

### 2. Use neutral media language

Replace user-facing uses of **“clip”** with:

> **“this piece”**

when the missing/generated element could eventually be:

- video
- photo/image
- voice
- music
- sound effect
- other generated media

Keep media-specific terminology only where it is genuinely accurate and useful.

This should be the preferred product language going forward because YouFlicks is not intended to remain video-only.

Proceed with PR-10 using these choices and the Architect's approved corrections.

No Product Constitution change is required.

## Effect

1. The draft copy in lock r3 (L609-L619) is superseded for these two points only. The final PR-10 strings are listed in the PR-10 report for PO confirmation before merge (P-8, lock L1074).
2. Nothing else changes: lock r3 (`16ea2660…`), CSV (`b187fc0a…`), PO decision 2026-09-25 (`d1517954…`) and registry `sg-lanes-v1` (`06601e8f…`) are unaffected. The Product Constitution is unchanged. LAUNCH_GATE stays on HOLD. No provider is enabled for paid generation.

## Source trail

- Architect PR-10 handoff review recommended both changes (Q1, Q6); Architect relayed this decision to Chief of Staff with notes: Q6 applies to the Q1 waiting string wherever the role is not guaranteed to be video; photo copy is chosen only on a verified photo fallback (E-5 test).
