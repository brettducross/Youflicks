# Beta AI processing consent — PO / counsel copy template

**Status:** Fill-in-the-blank **template**. This is **not** counsel-approved legal text. Eng must not invent final wording.  
**Product requirement (locked, W0-3):** consent UX before vendor upload / HTTP vision / gateway generate; Constitution “never train on customer footage by default” must be **honest** in the published copy and in the vendor checklist.  
**Code:** `AiProcessingConsent.policyVersion` is an open string (default `beta-ai-v1`). Banner + `POST /api/me/ai-consent` record acceptance. Server enqueue to vendor paths fails closed without a row for the **current** version.

Draft public route (placeholder until this template is filled): `/legal/ai-processing-draft`  
In-app banner currently labels itself a legal placeholder and links that route.

---

## How to publish copy (Brett)

1. Fill every blank below with counsel-reviewed language (or an explicit “not offered in this beta” sentence). Do not leave `_fill_` markers in the published notice.
2. Confirm vendor settings/DPA match the never-train and retention claims (Replicate or whichever engine is actually configured — provider-neutral; no permanent vendor lock).
3. Bump `AI_CONSENT_POLICY_VERSION` on the **app** process to a new open string (example: `beta-ai-v2`). Existing acceptances for `beta-ai-v1` do **not** cover the new version; users will see the banner again. That is intended.
4. Replace the draft page body (and banner placeholder sentence) with the filled notice, or point the banner at the published URL. Keep the version string visible.
5. Tick the legal row in [LAUNCH_GATE_CHECKLIST.md](./LAUNCH_GATE_CHECKLIST.md). **Do not mint invites** until that row PASSes.

### Version bump (ops)

```bash
# Host secret / env only — do not commit the value as “approved” in git until copy exists.
AI_CONSENT_POLICY_VERSION="beta-ai-v2"
```

`ConsentService` reads `env.AI_CONSENT_POLICY_VERSION`. No Prisma enum, no CreativePlan field.

---

## Required honesty clauses (fill blanks)

Replace each `_fill_` with counsel-approved text. Headings are the required topics, not the legal words.

### 1. Who processes footage (third-party processors)

_YouFlicks may send photos, video frames, audio, or transcripts to the following processors for the purposes in §2:_

- Processor legal name: `_fill_`
- Role (analysis / generation / both): `_fill_`
- Where processing occurs (region / country if known): `_fill_`
- Subprocessors named in the vendor terms (or “none disclosed / see vendor DPA dated _fill_”): `_fill_`

_Do not list a vendor that is not actually configured. If a processor is not used in this beta, write that it is not used._

### 2. Purpose

_We send that material only to:_ `_fill_`  
_(Allowed examples of purpose — rewrite in counsel’s words, do not paste as-is: analyze your media so the product can describe it; generate optional clips you requested; render/export your movie. Forbidden: silent secondary use you did not describe.)_

### 3. Never-train-by-default (Constitution)

_YouFlicks does not train foundation models on customer footage by default._

_Vendor training / retention setting we rely on:_ `_fill_`  
_Date / ticket / console evidence that the setting is on:_ `_fill_`  
_If a vendor cannot honor never-train:_ `_fill_` _(must not ship that vendor for beta, or the published copy must say training may occur — do not hide it)_

### 4. Retention (best-effort honesty)

_YouFlicks project/account delete + StoragePort GC:_ see wipe SLA ≤ 24h ([BETA_WIPE_RUNBOOK.md](./BETA_WIPE_RUNBOOK.md)).

_Vendor-side copies (files/predictions) retention we can honestly claim:_ `_fill_`  
_What we cannot guarantee (best-effort / vendor API limits):_ `_fill_`

### 5. How to withdraw

_To withdraw consent and/or delete beta data:_ `_fill_`  
_(Product path: `DELETE /api/projects/:id` and `DELETE /api/me/account`. Ops path: wipe runbook. After withdraw, vendor enqueue stays blocked until the user accepts the **current** policy version again.)_

_Contact for deletion requests:_ `_fill_`

---

## UI placement (Eng already)

| Surface | Today | After PO fills |
| --- | --- | --- |
| App banner | Placeholder + link to `/legal/ai-processing-draft` | Same banner; body must match published version |
| Accept control | `I consent to AI processing` → `POST /api/me/ai-consent` | Keep; do not treat a checkbox as a ToS dump unless counsel says so |
| Gate | No vendor upload / HTTP vision / gateway generate without a consent row | Unchanged |

Do **not** put this copy in CreativePlan JSON.

---

## Explicit non-goals

- Eng will not draft “final” privacy policy, ToS, or DPA language.
- This template does not authorize public registration or invite mint.
- Provider names above are blanks; filling them is not a permanent architectural vendor default.
