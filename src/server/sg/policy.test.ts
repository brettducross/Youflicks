import { readFileSync } from "node:fs";
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
import {
  SG_POLICY_CONTRACT_REASON,
  SelectiveGenerationPolicy,
  decide,
  routeDecisionSchema,
  type AttemptSoFar,
  type BudgetSnapshot,
  type RegistrySnapshot,
  type ShotCues,
} from "@/server/sg/policy";

function cues(overrides: Partial<ShotCues> = {}): ShotCues {
  return {
    requiredScopes: ["HERO"],
    ...overrides,
  };
}

function registry(overrides: Partial<RegistrySnapshot["lanes"][number]> = {}): RegistrySnapshot {
  return {
    lanes: [
      {
        laneId: "r1-wan27-replicate",
        laneClass: "standard",
        providerKey: "replicate:wan-video/wan-2.7-i2v",
        enabled: true,
        gates: {
          HERO: "QUALIFIED",
          IDENTITY: "QUALIFIED",
          NON_IDENTITY: "QUALIFIED",
        },
        ...overrides,
      },
    ],
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

  it("decides nothing: a qualified lane is not selected, and the call is pure", () => {
    const inputCues = cues({ requiredScopes: ["IDENTITY", "HERO"] });
    const snapshot = registry({
      laneId: "kling3-pro-audio-off",
      laneClass: "premium",
      providerKey: "TBD:kling3-pro-audio-off",
      enabled: true,
      gates: {
        HERO: "QUALIFIED",
        IDENTITY: "QUALIFIED",
        NON_IDENTITY: "NOT_QUALIFIED",
      },
    });
    const attempts: AttemptSoFar[] = [
      { laneClass: "draft-cost", outcome: "FAILED", classAttemptNo: 3 },
    ];
    const before = structuredClone({ inputCues, snapshot, attempts, budget });

    const first = SelectiveGenerationPolicy.decide(inputCues, snapshot, budget, attempts);
    const second = decide(inputCues, snapshot, budget, attempts);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).toEqual({
      treatment: null,
      laneClass: null,
      laneId: null,
      providerKey: null,
      decisionReason: SG_POLICY_CONTRACT_REASON,
    });
    expect(routeDecisionSchema.parse(first)).toEqual(first);
    expect(first).not.toBeInstanceOf(Promise);
    expect({ inputCues, snapshot, attempts, budget }).toEqual(before);
  });

  it("accepts an empty registry and an open providerKey without a database", () => {
    const decision = decide(
      cues({ requiredScopes: ["NON_IDENTITY"] }),
      {
        lanes: [
          {
            laneId: "boreal-720",
            laneClass: "draft-cost",
            providerKey: "TBD:boreal-720",
            enabled: false,
            gates: {
              HERO: "NOT_QUALIFIED",
              IDENTITY: "NOT_QUALIFIED",
              NON_IDENTITY: "SUSPENDED",
            },
          },
        ],
      },
      { projectMaxUsd: null, projectMaxSeconds: 30 },
      [],
    );
    expect(decision.laneId).toBeNull();
    expect(decision.providerKey).toBeNull();
    expect(decision.treatment).toBeNull();
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

    expect(() => decide(cues(), registry(), { projectMaxUsd: "8" as never }, [])).toThrow(
      /budgetSnapshot is outside the SG\.0 contract/,
    );
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
