import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_OUTCOMES,
  attemptOutcomeSchema,
  GATE_STATUSES,
  gateStatusSchema,
  LANE_CLASSES,
  laneClassSchema,
  ROUTING_SCOPES,
  routingScopeSchema,
  TREATMENTS,
  treatmentSchema,
} from "@/server/sg/constants";
import { SG_MESSAGE_KEYS } from "@/server/sg/constants";
import { DEFAULT_SG_ROUTING_MODE } from "@/server/sg/routing-mode";
import {
  SG_POLICY_CONTRACT_REASON,
  SelectiveGenerationPolicy,
  decide,
  legacyModelGuard,
  planRoute,
  routeDecisionSchema,
  type AttemptSoFar,
  type BudgetSnapshot,
  type RegistryLaneSnapshot,
  type RegistrySnapshot,
  type ShotCues,
} from "@/server/sg/policy";

function cues(overrides: Partial<ShotCues> = {}): ShotCues {
  return {
    requiredScopes: ["HERO"],
    routingMode: "ENFORCED",
    ...overrides,
  };
}

function lane(overrides: Partial<RegistryLaneSnapshot> = {}): RegistryLaneSnapshot {
  return {
    laneId: "lane-a",
    laneClass: "draft-cost",
    providerKey: "open:lane-a",
    enabled: true,
    healthy: true,
    designation: "NONE",
    resolutionTier: "720p",
    modelId: "model-a",
    gates: {
      HERO: "QUALIFIED",
      IDENTITY: "QUALIFIED",
      NON_IDENTITY: "QUALIFIED",
    },
    ...overrides,
  };
}

function registry(overrides: Partial<RegistryLaneSnapshot> = {}, extra: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
  return {
    lanes: [lane(overrides)],
    ...extra,
  };
}

const budget: BudgetSnapshot = {};

describe("SG.0 policy contract", () => {
  it("pins the locked vocabularies and rejects proposal-era aliases", () => {
    expect([...ROUTING_SCOPES]).toEqual(["HERO", "IDENTITY", "NON_IDENTITY"]);
    expect([...LANE_CLASSES]).toEqual(["draft-cost", "draft-quality", "standard", "premium"]);
    expect([...TREATMENTS]).toEqual([
      "ORIGINAL",
      "KEN_BURNS",
      "STATIC",
      "REUSE",
      "GENERATE",
      "DEFER",
      "FAIL_HONEST",
    ]);
    expect([...GATE_STATUSES]).toEqual(["NOT_QUALIFIED", "QUALIFIED", "SUSPENDED"]);
    expect([...ATTEMPT_OUTCOMES]).toEqual([
      "PENDING",
      "SUCCEEDED",
      "FAILED",
      "CAP_DENIED",
      "TIMEOUT_UNRECONCILED",
      "CANCELLED",
      "REJECTED_TECHNICAL",
    ]);

    expect(routingScopeSchema.safeParse("B_ROLL").success).toBe(false);
    expect(laneClassSchema.safeParse("DRAFT_COST").success).toBe(false);
    expect(treatmentSchema.parse("KEN_BURNS")).toBe("KEN_BURNS");
    expect(treatmentSchema.safeParse("SIMPLE_MOTION").success).toBe(false);
    expect(treatmentSchema.safeParse("ORIGINAL_PHOTO").success).toBe(false);
    expect(gateStatusSchema.parse("NOT_QUALIFIED")).toBe("NOT_QUALIFIED");
    expect(gateStatusSchema.safeParse("PASSED").success).toBe(false);
    expect(gateStatusSchema.safeParse("DEFAULT").success).toBe(false);
    expect(attemptOutcomeSchema.parse("CANCELLED")).toBe("CANCELLED");
    expect(attemptOutcomeSchema.safeParse("CAP_HIT").success).toBe(false);
    expect(attemptOutcomeSchema.safeParse("CANCELED").success).toBe(false);
  });

  it("is pure and never returns the unevaluated contract sentinel", () => {
    const inputCues = cues({ requiredScopes: ["IDENTITY", "HERO"] });
    const snapshot = registry({ laneId: "lane-a", laneClass: "premium" });
    const attempts: AttemptSoFar[] = [
      { laneClass: "draft-cost", outcome: "FAILED", classAttemptNo: 3 },
    ];
    const before = structuredClone({ inputCues, snapshot, attempts, budget });
    const first = SelectiveGenerationPolicy.decide(inputCues, snapshot, budget, attempts);
    const second = decide(inputCues, snapshot, budget, attempts);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.treatment).toBe("GENERATE");
    expect(first.decisionReason).not.toBe(SG_POLICY_CONTRACT_REASON);
    expect(JSON.stringify(first)).not.toContain(SG_POLICY_CONTRACT_REASON);
    expect(routeDecisionSchema.parse(first)).toEqual(first);
    expect(first).not.toBeInstanceOf(Promise);
    expect({ inputCues, snapshot, attempts, budget }).toEqual(before);
    expect(DEFAULT_SG_ROUTING_MODE).toBe("LEGACY");
  });

  it("rejects a half-filled GENERATE decision", () => {
    expect(
      routeDecisionSchema.safeParse({
        treatment: "GENERATE",
        laneClass: "draft-cost",
        laneId: null,
        providerKey: "open:lane-a",
        decisionReason: "missing lane",
        messageKey: null,
      }).success,
    ).toBe(false);
    expect(
      routeDecisionSchema.safeParse({
        treatment: "DEFER",
        laneClass: "draft-cost",
        laneId: "lane-a",
        providerKey: null,
        decisionReason: "lane set",
        messageKey: SG_MESSAGE_KEYS.NO_QUALIFIED_LANE,
      }).success,
    ).toBe(false);
  });

  it("defers a HERO with no qualified healthy lane", () => {
    const decision = decide(
      cues({ requiredScopes: ["HERO"] }),
      registry({
        gates: { HERO: "NOT_QUALIFIED", IDENTITY: "QUALIFIED", NON_IDENTITY: "QUALIFIED" },
      }),
      budget,
      [],
    );
    expect(decision.treatment).toBe("DEFER");
    expect(decision.laneId).toBeNull();
    expect(decision.messageKey).toBe(SG_MESSAGE_KEYS.NO_QUALIFIED_LANE);
  });

  it("does not route IDENTITY to an unqualified or 480p draft lane, and may use a qualified 720p draft-cost lane", () => {
    const unqualified = decide(
      cues({ requiredScopes: ["IDENTITY"], routingMode: "ENFORCED" }),
      registry({
        resolutionTier: "720p",
        gates: { HERO: "NOT_QUALIFIED", IDENTITY: "NOT_QUALIFIED", NON_IDENTITY: "QUALIFIED" },
      }),
      budget,
      [],
    );
    expect(unqualified.treatment).toBe("DEFER");
    expect(unqualified.laneId).toBeNull();

    const lowRes = decide(
      cues({ requiredScopes: ["IDENTITY"] }),
      registry({ resolutionTier: "480p" }),
      budget,
      [],
    );
    expect(lowRes.laneId).toBeNull();
    expect(lowRes.treatment).toBe("DEFER");

    const pro = decide(cues({ requiredScopes: ["HERO"] }), registry({ resolutionTier: "pro" }), budget, []);
    expect(pro.laneId).toBeNull();

    const qualifiedDraft = decide(
      cues({ requiredScopes: ["IDENTITY"] }),
      registry({ laneClass: "draft-cost", resolutionTier: "720p" }),
      budget,
      [],
    );
    expect(qualifiedDraft).toMatchObject({
      treatment: "GENERATE",
      laneClass: "draft-cost",
      laneId: "lane-a",
    });
  });

  it("starts NON_IDENTITY at a qualified draft-cost lane and does not skip a class", () => {
    const decision = decide(
      cues({ requiredScopes: ["NON_IDENTITY"] }),
      {
        lanes: [
          lane({ laneId: "lane-a", laneClass: "draft-cost" }),
          lane({ laneId: "lane-b", laneClass: "standard", providerKey: "open:lane-b" }),
        ],
      },
      budget,
      [],
    );
    expect(decision).toMatchObject({ treatment: "GENERATE", laneId: "lane-a", laneClass: "draft-cost" });

    const skipped = decide(
      cues({ requiredScopes: ["NON_IDENTITY"] }),
      {
        lanes: [
          lane({
            laneId: "lane-a",
            laneClass: "draft-cost",
            gates: { HERO: "NOT_QUALIFIED", IDENTITY: "NOT_QUALIFIED", NON_IDENTITY: "NOT_QUALIFIED" },
          }),
          lane({ laneId: "lane-b", laneClass: "standard", providerKey: "open:lane-b" }),
        ],
      },
      budget,
      [{ laneClass: "draft-cost", outcome: "FAILED", classAttemptNo: 3 }],
    );
    expect(skipped.treatment).not.toBe("GENERATE");
    expect(skipped.laneId).toBeNull();
    expect(skipped.messageKey).toBe(SG_MESSAGE_KEYS.CEILING_REACHED);
  });

  it("escalates exactly one qualified class after 3 draft-cost attempts and falls back at premium", () => {
    const escalated = decide(
      cues({ requiredScopes: ["NON_IDENTITY"] }),
      {
        lanes: [
          lane({ laneId: "lane-a", laneClass: "draft-cost" }),
          lane({ laneId: "lane-b", laneClass: "draft-quality", providerKey: "open:lane-b" }),
        ],
      },
      budget,
      [{ laneClass: "draft-cost", outcome: "FAILED", classAttemptNo: 3 }],
    );
    expect(escalated).toMatchObject({ treatment: "GENERATE", laneId: "lane-b", laneClass: "draft-quality" });

    const topped = decide(
      cues({ requiredScopes: ["NON_IDENTITY"] }),
      registry({ laneId: "lane-prem", laneClass: "premium", providerKey: "open:prem" }),
      budget,
      [
        { laneClass: "draft-cost", outcome: "FAILED", classAttemptNo: 3 },
        { laneClass: "draft-quality", outcome: "FAILED", classAttemptNo: 2 },
        { laneClass: "standard", outcome: "FAILED", classAttemptNo: 2 },
        { laneClass: "premium", outcome: "FAILED", classAttemptNo: 2 },
      ],
    );
    expect(topped.treatment).toBe("DEFER");
    expect(topped.messageKey).toBe(SG_MESSAGE_KEYS.CEILING_REACHED);
    expect(topped.laneId).toBeNull();
  });

  it("skips SUSPENDED and unhealthy lanes and does not fall through to an unqualified lane", () => {
    const suspended = decide(
      cues({ requiredScopes: ["NON_IDENTITY"] }),
      registry({
        gates: { HERO: "SUSPENDED", IDENTITY: "SUSPENDED", NON_IDENTITY: "SUSPENDED" },
      }),
      budget,
      [],
    );
    expect(suspended.laneId).toBeNull();

    const unhealthy = decide(
      cues({ requiredScopes: ["NON_IDENTITY"] }),
      {
        lanes: [
          lane({ laneId: "lane-a", healthy: false }),
          lane({
            laneId: "lane-b",
            laneClass: "draft-quality",
            providerKey: "open:lane-b",
            healthy: true,
            gates: { HERO: "NOT_QUALIFIED", IDENTITY: "NOT_QUALIFIED", NON_IDENTITY: "NOT_QUALIFIED" },
          }),
        ],
      },
      budget,
      [],
    );
    expect(unhealthy.laneId).toBeNull();
    expect(unhealthy.messageKey).toBe(SG_MESSAGE_KEYS.NO_QUALIFIED_LANE);
  });

  it("does not retry or pick another lane after a cap hit", () => {
    const decision = decide(
      cues({ requiredScopes: ["NON_IDENTITY"] }),
      {
        lanes: [
          lane({ laneId: "lane-a" }),
          lane({ laneId: "lane-b", providerKey: "open:lane-b" }),
        ],
      },
      { projectBlocked: true },
      [],
    );
    expect(decision).toMatchObject({
      treatment: "DEFER",
      laneId: null,
      messageKey: SG_MESSAGE_KEYS.CAP_REACHED,
    });
    const plan = planRoute(
      cues({ requiredScopes: ["NON_IDENTITY"] }),
      registry(),
      { projectBlocked: true },
      [{ laneClass: "draft-cost", outcome: "CAP_DENIED", classAttemptNo: 1 }],
    );
    expect(plan.stopJob).toBe(true);
    expect(plan.applied.laneId).toBeNull();
  });

  it("refuses LEGACY_R1 for identity scopes, unclassified attempts, and timeout or cancel", () => {
    const legacy = decide(
      cues({ requiredScopes: ["IDENTITY", "HERO"], routingMode: "ENFORCED" }),
      registry({ designation: "LEGACY_R1", resolutionTier: "1080p", laneClass: "premium" }),
      budget,
      [],
    );
    expect(legacy.treatment).not.toBe("GENERATE");
    expect(legacy.laneId).toBeNull();

    for (const extra of [
      { unclassifiedAttemptCount: 1 },
      { registryUnavailable: true },
    ] as const) {
      const refused = decide(
        cues({ requiredScopes: ["NON_IDENTITY"], routingMode: "ENFORCED" }),
        registry({}, extra),
        budget,
        [],
      );
      expect(refused.treatment).not.toBe("GENERATE");
      expect(refused.laneId).toBeNull();
    }

    for (const outcome of ["TIMEOUT_UNRECONCILED", "CANCELLED"] as const) {
      const blocked = decide(
        cues({ requiredScopes: ["NON_IDENTITY"], routingMode: "ENFORCED" }),
        registry(),
        budget,
        [{ laneClass: "draft-cost", outcome, classAttemptNo: 1 }],
      );
      expect(blocked.treatment).toBe("DEFER");
      expect(blocked.laneId).toBeNull();
      expect(blocked.messageKey).toBe(SG_MESSAGE_KEYS.FAILED_HONEST);
    }
  });

  it("never generates a dialogue close-up in LEGACY or ENFORCED", () => {
    for (const routingMode of ["LEGACY", "ENFORCED"] as const) {
      const decision = decide(
        cues({
          routingMode,
          shotRole: "dialogue-closeup",
          requiredScopes: ["IDENTITY"],
          sourceStillExists: true,
        }),
        registry({ designation: "LEGACY_R1", laneId: "lane-a" }),
        budget,
        [],
      );
      expect(decision.treatment).not.toBe("GENERATE");
      expect(decision.laneId).toBeNull();
      expect(decision.messageKey).toBe(SG_MESSAGE_KEYS.WAITING);
    }
    const covered = decide(
      cues({ shotRole: "dialogue-closeup", originalCoversSlot: true, routingMode: "LEGACY" }),
      registry(),
      budget,
      [],
    );
    expect(covered.treatment).toBe("ORIGINAL");
    expect(covered.messageKey).toBe(SG_MESSAGE_KEYS.FALLBACK_ORIGINAL);
  });

  it("routes LEGACY non-dialogue to the enabled LEGACY_R1 lane and stores an ENFORCED shadow", () => {
    const snapshot = registry({ designation: "LEGACY_R1", healthy: false, gates: {
      HERO: "NOT_QUALIFIED",
      IDENTITY: "NOT_QUALIFIED",
      NON_IDENTITY: "NOT_QUALIFIED",
    } });
    const plan = planRoute(cues({ routingMode: "LEGACY", requiredScopes: ["IDENTITY"] }), snapshot, budget, []);
    expect(plan.applied).toMatchObject({ treatment: "GENERATE", laneId: "lane-a" });
    expect(plan.shadow.treatment).not.toBe("GENERATE");
    expect(plan.shadow.laneId).toBeNull();
    expect(plan.legacyModelId).toBe("model-a");
  });

  it("treats PRESENT and UNKNOWN with the same scopes as the same route", () => {
    const snapshot = registry();
    const present = decide(cues({ identityState: "PRESENT", requiredScopes: ["IDENTITY"] }), snapshot, budget, []);
    const unknown = decide(cues({ identityState: "UNKNOWN", requiredScopes: ["IDENTITY"] }), snapshot, budget, []);
    expect(unknown).toEqual(present);
    expect(() =>
      decide(
        { ...cues(), analysisCompleted: true } as ShotCues,
        snapshot,
        budget,
        [],
      ),
    ).toThrow(/cues is outside the SG\.0 contract/);
  });

  it("refuses a LEGACY model override that disagrees with the registry model id", () => {
    expect(legacyModelGuard({ assetHttpModel: undefined, registryModelId: "model-a" })).toEqual({ ok: true });
    expect(legacyModelGuard({ assetHttpModel: "model-a", registryModelId: "model-a" })).toEqual({ ok: true });
    const refused = legacyModelGuard({ assetHttpModel: "other-model", registryModelId: "model-a" });
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      throw new Error("expected mismatch");
    }
    expect(refused.reason).not.toContain("other-model");
    expect(refused.reason).not.toContain("model-a");
  });

  it("accepts an empty registry without a database", () => {
    const decision = decide(
      cues({ requiredScopes: ["NON_IDENTITY"], routingMode: "ENFORCED" }),
      { lanes: [] },
      budget,
      [],
    );
    expect(decision.laneId).toBeNull();
    expect(decision.providerKey).toBeNull();
    expect(decision.treatment).toBe("DEFER");
  });

  it("rejects vocabulary outside the contract", () => {
    expect(() =>
      decide(
        { requiredScopes: ["HERO", "B_ROLL" as "HERO"] },
        registry(),
        budget,
        [],
      ),
    ).toThrow(/cues is outside the SG\.0 contract/);

    expect(() =>
      decide(cues(), registry({ laneClass: "ultra" as "premium" }), budget, []),
    ).toThrow(/registrySnapshot is outside the SG\.0 contract/);

    expect(() =>
      decide(cues(), registry(), budget, [
        { laneClass: "standard", outcome: "CAP_HIT" as "FAILED", classAttemptNo: 1 },
      ]),
    ).toThrow(/attemptsSoFar is outside the SG\.0 contract/);

    expect(() => decide(cues(), registry(), { projectMaxUsd: "8" } as never, [])).toThrow(
      /budgetSnapshot is outside the SG\.0 contract/,
    );
  });

  it("does not let creative modules import the policy", () => {
    const roots = ["src/server/director", "src/server/story", "src/server/timeline", "src/server/ports"];
    for (const root of roots) {
      const abs = path.join(process.cwd(), root);
      const files = listTs(abs);
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        expect(src, file).not.toMatch(/@\/server\/sg\/policy/);
      }
    }
  });

  it("does not import a database, filesystem, or network client", () => {
    const src = readFileSync(path.join(process.cwd(), "src/server/sg/policy.ts"), "utf8");
    expect(src).not.toMatch(/prisma|@\/server\/db|node:fs|node:net|fetch\(/);
    const constants = readFileSync(
      path.join(process.cwd(), "src/server/sg/constants.ts"),
      "utf8",
    );
    expect(constants).not.toMatch(/prisma|@\/server\/db/);
  });
});

function listTs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listTs(full));
      continue;
    }
    if (full.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}
