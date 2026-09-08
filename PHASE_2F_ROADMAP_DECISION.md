# Phase 2F Roadmap Decision Document

**Status:** Approved specification — not implemented  
**Phase name:** Director Execution & Creative Plan Persistence  
**Basis:** Approved Phase 2F specification (Brett + ChatGPT); `ARCHITECTURE.md`; `README.md`; locked provider-agnostic rules; Phase 2E Director contract on `main` @ `95bca79`  
**This document:** Authoritative specification for a **future** Phase 2F implementation. Phase 2F is **not started in code**. Do not treat this file as evidence that Director execution exists.

`ARCHITECTURE.md` has no 2F section and jumps from 2E → **Phase 3 — Story & timeline**. README names “Phase 2F” and forbids story/timeline/commercial Director work until that phase is requested. This document is the approved middle: execute the 2E contract and persist a `CreativePlan`. It does **not** implement Phase 3.

---

## 1. Objective

Turn the existing Phase 2E Director contract into a real, asynchronous Director capability that produces and persists a validated, versioned YouFlicks-owned `CreativePlan`, **and nothing beyond that**.

Phase 2E shipped the contract (`DirectorInput`, `CreativePlan` schema, assemble/validate, capability gateway) with `container.aiDirector()` unconfigured. Phase 2F **runs** that contract: assemble input, compose through `AiDirectorPort`, validate, persist the plan as a first-class artifact, and prove job-backed execution.

This is **not** generating a film, story document, timeline, or render.

---

## 2. Must include

1. **First-class `CreativePlan` persistence**
   - Project-linked
   - Versioned
   - Status
   - Validated YouFlicks-owned JSON
   - Provenance
   - Job linkage
   - Timestamps
   - Preserve previous versions rather than overwrite them
   - **Do not** store the plan inside `StoryStructure`

2. **`DirectorService`**
   - Assemble Director input
   - Request composition through `AiDirectorPort`
   - Validate the returned plan
   - Persist it
   - Record attribution

3. **`AI_DIRECT` asynchronous execution**
   - HTTP requests enqueue work
   - Director composition occurs through the job/worker path
   - No long-running AI execution inside HTTP

4. **Real Director adapter boundary**
   - Use `AiDirectorPort`
   - No provider names in domain logic
   - No provider-specific JSON persisted
   - Provider implementations remain replaceable

5. **Test/local deterministic adapter (allowed, limited)**
   - Allowed for tests, development, and contract verification
   - Must **not** masquerade as production AI
   - Must **not** be used to falsely mark the production Director capability as available

6. **Honest production capability**
   - Director becomes available only when an actual configured Director adapter exists
   - Missing capability produces a typed error
   - No fake creative fallback

7. **Iteration continuity**
   - `priorDecisions` should use the previous READY `CreativePlan` when recomposing
   - Do not create a chat system

8. **Reproducibility**
   - Persist originating `jobId`
   - Persist an appropriate fingerprint/hash of assembled Director input
   - Do not unnecessarily persist sensitive raw input

9. **Meaning-level `CreativePlan`**
   - Creative intent, concept, tone, arc, strategic decisions, rationale
   - Must **not** become clip cut lists, absolute timeline timings, render specifications, timeline state, or NLE instructions

10. **Minimal authenticated UI**
    - Request/compose
    - Status
    - View `CreativePlan`
    - No timeline editor
    - No Director chat
    - No rendering

---

## 3. Must not include

- `StoryStructure` generation or population
- `Timeline`
- `TimelineClip`
- Rendering
- `RenderJob`
- `FinishedMovie`
- `Publication`
- Generate Film
- Director chat
- Evaluation scoring
- Advertising
- Sponsorship influencing creative decisions
- Billing / payments
- Mobile
- Worker infrastructure extraction
- Object-storage migration
- Provider-specific architecture
- Generic AI memory

Do not modify `StoryStructure`, `Timeline`, `TimelineClip`, `RenderJob`, `FinishedMovie`, or `Publication` schemas as part of Phase 2F.

---

## 4. Contracts

**Consume (already authoritative from Phase 2E):**

- `AiDirectorPort.composePlan(input: DirectorInput): Promise<CreativePlan>`
- `DirectorInput` privacy rules
- Versioned `CreativePlan` / `creativePlanSchema`
- `DirectorCapabilityGateway` (availability / `require`)
- `DirectorContractService.assembleInput` / `validatePlan`
- Capability registry + selection policy for Director-requested capabilities
- Typed errors for invalid input, unavailable capability, invalid plan, unavailable provider, and constraint conflict

**Add in 2F (thin, in service of the must-include list):**

- `DirectorService` — assemble, request compose via `AiDirectorPort`, validate, persist, attribution
- `AI_DIRECT` job path — HTTP enqueues; worker performs composition
- First-class `CreativePlan` store — versioned rows, not an overwrite, not `StoryStructure`

**Do not redefine** Storage, Jobs, Analysis, or Renderer ports in this phase.

**Architectural rule:** a deterministic/local adapter may exist for testing and development. It must never be represented as real production AI merely to make the Director capability appear available. The production Director capability is available only when a genuine configured adapter exists behind `AiDirectorPort`.

---

## 5. Database / provenance

`CreativePlan` is a first-class persisted artifact (new model or equivalent). It is **not** dumped into `StoryStructure`.

Required fields / qualities:

- Project linkage
- Versioning (preserve previous versions; do not overwrite)
- Status
- Validated YouFlicks-owned plan JSON (meaning-level only)
- Timestamps
- Job linkage

Required provenance:

- `providerKey`
- `capability`
- `jobId`
- Input fingerprint/hash (of assembled Director input)

`modelId` / `modelVersion` may be optional. They must not become provider-specific architectural requirements.

Do not add provider-specific architecture, vendor enums, or a generic AI memory table.

Do not change `StoryStructure`, `Timeline`, `TimelineClip`, `RenderJob`, `FinishedMovie`, or `Publication` schemas in Phase 2F.

---

## 6. Services

| Piece | Role in 2F |
| --- | --- |
| `DirectorContractService` | Unchanged 2E foundation: assemble input, validate plan |
| **`DirectorService`** | Assemble input; request composition through `AiDirectorPort`; validate; persist; record attribution |
| **`AI_DIRECT` worker path** | Perform Director composition off the HTTP request; persist validated plan; record `jobId` and other required provenance |
| **`AiDirectorPort` adapters** | Replaceable implementations behind the port. A test/local deterministic adapter is allowed only for tests/development/contract verification. A genuine configured adapter is required for production Director availability. |
| Existing Taste / Intent / Media / Analysis | Inputs only, via assembled Director input |

Sponsorship must not influence creative decisions. Credits/billing paths are not part of 2F.

`renderer()` stays unimplemented.

---

## 7. APIs / UI

**Minimal authenticated surface (owner-only):**

- Request / compose — HTTP enqueues `AI_DIRECT`; does not run Director composition inline
- Status — queued / in progress / ready / failed (or equivalent honest states)
- View `CreativePlan` — read-only meaning-level plan (intent, concept, tone, arc, strategic decisions, rationale)

**Must not appear:**

- Timeline editor
- Director chat
- Rendering, download movie, or Generate Film

---

## 8. Acceptance criteria

Phase 2F is complete only when all of the following are true. A local/deterministic adapter used only in tests or development does **not** satisfy production availability.

- [ ] First-class `CreativePlan` persistence exists: project-linked, versioned, statused, validated YouFlicks-owned JSON, timestamps, job linkage; previous versions preserved
- [ ] Required provenance persisted: `providerKey`, `capability`, `jobId`, input fingerprint/hash
- [ ] Optional `modelId` / `modelVersion` are not treated as provider-specific architecture
- [ ] `DirectorService` assembles input, composes through `AiDirectorPort`, validates, persists, and records attribution
- [ ] HTTP only enqueues `AI_DIRECT`; composition runs on the job/worker path
- [ ] Domain logic has no provider names; no provider-specific JSON is persisted; adapters remain replaceable
- [ ] Test/local deterministic adapter (if present) is not represented as production AI and does not mark production Director available
- [ ] Production Director is available only when a genuine configured adapter exists behind `AiDirectorPort`
- [ ] Missing capability → typed error; no fake creative fallback
- [ ] Recompose uses previous READY `CreativePlan` for `priorDecisions`; no chat system
- [ ] Sensitive raw Director input is not persisted unnecessarily
- [ ] Persisted `CreativePlan` is meaning-level only (not cut lists, absolute timings, render specs, timeline state, or NLE instructions)
- [ ] Minimal authenticated UI: request/compose, status, view plan — no timeline editor, Director chat, or rendering
- [ ] No writes to or schema changes for `StoryStructure`, `Timeline`, `TimelineClip`, `RenderJob`, `FinishedMovie`, or `Publication`
- [ ] No Generate Film, evaluation scoring, advertising, sponsorship-influenced creative decisions, billing/payments, mobile, worker extraction, object-storage migration, provider-specific architecture, or generic AI memory

---

## 9. Dependencies on 2A–2E

| Phase | Why 2F depends on it |
| --- | --- |
| **1** | Auth, Prisma, ports, project shell |
| **2A** | Media inventory for assembled Director input |
| **2B–2C** | Normalized `MediaAnalysis` + registry/policy already stored; Director must not invent a parallel provider-specific understanding path |
| **2D** | Taste + project intent for the creative brief; attribution patterns for provenance |
| **2E** | The contract 2F executes (`assembleInput`, `AiDirectorPort`, `validatePlan`, capability gateway) |

---

## 10. Phase 3 relationship

Phase 2F prepares the architecture for:

**`CreativePlan` → `StoryStructure` → `Timeline` → Render**

Phase 2F does **not** implement that pipeline.

Phase 3 (authoritative in `ARCHITECTURE.md` as **Story & timeline**) is where an owned `StoryStructure` and timeline would be derived. Rendering and later stages remain after that.

---

## 11. Risks

1. **Treating a test/local adapter as production Director** — would falsely mark the capability available. Mitigate: production availability requires a genuine configured adapter behind `AiDirectorPort`; local/deterministic adapters stay test/dev/contract-only.
2. **Scope creep into Generate Film / story / timeline / render** — UI and persistence must keep `CreativePlan` meaning-level; plan ≠ movie.
3. **Dumping the plan into `StoryStructure`** — blurs 2F and Phase 3 and invites provider-shaped payloads. Mitigate: first-class `CreativePlan` artifact only.
4. **Persisting provider-specific JSON or sensitive raw input** — violates the adapter boundary and reproducibility rules. Persist owned plan JSON plus `jobId` and input fingerprint/hash; do not store host JSON or unnecessary raw input.
5. **Building Director chat for `priorDecisions`** — iteration continuity is previous READY plan → `priorDecisions`, not a conversational UI.
6. **Long-running compose on HTTP** — forbidden; enqueue `AI_DIRECT` only. Worker-process extraction is out of scope.

---

## 12. Implementation sequence

Phase 2F is **not started**. When it is requested, implement in this order and stop at the approved boundary:

1. Keep this approved specification as the lock; do not expand into Phase 3.
2. First-class `CreativePlan` persistence (new model or equivalent) + required provenance; no story/timeline/render schema changes.
3. `DirectorService`: assemble, compose via `AiDirectorPort`, validate, persist, attribution.
4. `AI_DIRECT` enqueue + worker path (`jobId`, input fingerprint/hash, no inline HTTP AI).
5. Adapter boundary: replaceable `AiDirectorPort` implementations. Test/local deterministic adapter only for tests/development/contract verification — never as fake production availability.
6. Genuine configured adapter required before production Director is available; missing capability → typed error.
7. Recompose: previous READY plan → `priorDecisions`; preserve prior versions.
8. Minimal authenticated UI: request/compose, status, view `CreativePlan`.

---

## 13. What Phase 2F is

**Phase 2F = Director Execution & Creative Plan Persistence.**

It sits between:

- **2E** — contracts only (`assembleInput` / `validatePlan` / unconfigured port)
- **Phase 3** — `CreativePlan` → `StoryStructure` → `Timeline` → Render (not implemented in 2F)

It does **not** mean generating films. It means the platform can ask the Director for a plan and keep that plan as a YouFlicks-owned artifact.

**Phase 2F is approved as specification only. It is not implemented.**
