import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SG_MESSAGE_KEYS, type SgMessageKey } from "@/server/sg/constants";
import { SG_COPY } from "@/server/sg/messages";
import { decide, planRoute, type BudgetSnapshot, type RegistryLaneSnapshot, type RegistrySnapshot, type ShotCues } from "@/server/sg/policy";

const FINAL_COPY: Record<SgMessageKey, string> = {
  SG_FALLBACK_ORIGINAL: "We used your original photo or video for this moment.",
  SG_FALLBACK_KEN_BURNS:
    "This moment uses your photo with gentle camera movement instead of a generated clip.",
  SG_FALLBACK_STATIC: "This moment shows your photo as a still.",
  SG_NO_QUALIFIED_LANE:
    "We can't make a moving clip for this moment at our quality bar yet, so we used your photo instead.",
  SG_CEILING_REACHED:
    "We tried a few versions of this moment and none met our quality bar, so we used your photo instead.",
  SG_WAITING: "This moment is waiting for this piece. Your movie can still be built without it.",
  SG_CAP_REACHED:
    "Generation of this piece is paused because a usage limit was reached. We did not retry automatically.",
  SG_FAILED_HONEST: "We couldn't make this piece for this moment. Nothing in your story was changed.",
  SG_REBUILD_HINT: "Rebuild your cut to include the updated moments.",
};

/**
 * Generic English tokens that the identifier split actually produces from
 * config/sg-lane-registry.json. They are not vendor or model names.
 * `lite` is absent on purpose: veo31lite keeps the leading letters `veo`
 * and the whole token `veo31lite`, so `lite` is never a token.
 */
const EXCLUDED_GENERIC_TOKENS = ["video", "quality", "cost", "fast", "pro", "audio", "off", "tbd"] as const;

const KEN_BURNS_PHRASES = ["ken burns", "kenburns"];

type RegistryNameSource = {
  lanes?: Array<{ providerKey?: string; modelId?: string; laneId?: string }>;
  processors?: Array<{ providerKey?: string; modelId?: string; laneId?: string }>;
};

function identifierTokens(value: string): string[] {
  const parts = value.split(/[:/.\-_]+/).filter((part) => part.length > 0);
  const tokens: string[] = [];
  for (const part of parts) {
    if (part.length >= 3) {
      tokens.push(part.toLowerCase());
    }
    const leading = /^[A-Za-z]+/.exec(part)?.[0] ?? "";
    if (leading.length >= 3 && leading.length < part.length) {
      tokens.push(leading.toLowerCase());
    }
  }
  return tokens;
}

function registryTokens(registry: RegistryNameSource): Set<string> {
  const tokens = new Set<string>();
  for (const row of [...(registry.lanes ?? []), ...(registry.processors ?? [])]) {
    for (const value of [row.providerKey, row.modelId, row.laneId]) {
      if (!value) continue;
      for (const token of identifierTokens(value)) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function fullRegistryNames(registry: RegistryNameSource): string[] {
  const names: string[] = [];
  for (const row of [...(registry.lanes ?? []), ...(registry.processors ?? [])]) {
    for (const value of [row.providerKey, row.modelId, row.laneId]) {
      if (value) names.push(value);
    }
  }
  return names;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function copyLintViolations(
  copy: Record<string, string>,
  registry: RegistryNameSource,
): string[] {
  const violations: string[] = [];
  const tokens = registryTokens(registry);
  const names = fullRegistryNames(registry);
  for (const [key, text] of Object.entries(copy)) {
    const lower = text.toLowerCase();
    for (const phrase of KEN_BURNS_PHRASES) {
      if (lower.includes(phrase)) {
        violations.push(`${key} contains ${phrase}`);
      }
    }
    for (const name of names) {
      if (name.length > 0 && lower.includes(name.toLowerCase())) {
        violations.push(`${key} contains registry name ${name}`);
      }
    }
    for (const token of tokens) {
      if ((EXCLUDED_GENERIC_TOKENS as readonly string[]).includes(token)) {
        continue;
      }
      if (new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(text)) {
        violations.push(`${key} contains registry token ${token}`);
      }
    }
    if (/[$€£¥]/.test(text) || /\bUSD\b/i.test(text) || /\d/.test(text)) {
      violations.push(`${key} contains currency or an amount`);
    }
    if (/\bupgrade\b/i.test(text) || /\bbuy\b/i.test(text)) {
      violations.push(`${key} contains upgrade or buy`);
    }
  }
  return violations;
}

function walk(dir: string, files: string[]) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      files.push(full);
    }
  }
}

function cues(overrides: Partial<ShotCues> = {}): ShotCues {
  return {
    requiredScopes: ["NON_IDENTITY"],
    shotRole: "other",
    identityState: "ABSENT",
    originalCoversSlot: false,
    sourceStillExists: false,
    motionNeed: "low",
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
    gates: { HERO: "NOT_QUALIFIED", IDENTITY: "NOT_QUALIFIED", NON_IDENTITY: "NOT_QUALIFIED" },
    ...overrides,
  };
}

const openBudget: BudgetSnapshot = {};
const blockedBudget: BudgetSnapshot = { projectBlocked: true };

describe("SG.6 copy map", () => {
  const registry = JSON.parse(
    readFileSync(path.join(process.cwd(), "config/sg-lane-registry.json"), "utf8"),
  ) as RegistryNameSource;

  it("equals the nine P-8 final strings", () => {
    expect(SG_COPY).toEqual(FINAL_COPY);
    expect(Object.keys(SG_COPY).sort()).toEqual(Object.values(SG_MESSAGE_KEYS).sort());
  });

  it("keeps clip wording only on the two verified-photo lines", () => {
    const clipKeys = Object.entries(SG_COPY)
      .filter(([, text]) => /\bclips?\b/i.test(text))
      .map(([key]) => key)
      .sort();
    expect(clipKeys).toEqual(["SG_FALLBACK_KEN_BURNS", "SG_NO_QUALIFIED_LANE"]);
  });

  it("keeps your photo only on the four photo-fallback lines", () => {
    const photoKeys = Object.entries(SG_COPY)
      .filter(([, text]) => text.toLowerCase().includes("your photo"))
      .map(([key]) => key)
      .sort();
    expect(photoKeys).toEqual([
      "SG_CEILING_REACHED",
      "SG_FALLBACK_KEN_BURNS",
      "SG_FALLBACK_STATIC",
      "SG_NO_QUALIFIED_LANE",
    ]);
  });

  it("lints the shipped copy against the lane registry", () => {
    const raw = registryTokens(registry);
    for (const token of EXCLUDED_GENERIC_TOKENS) {
      expect(raw.has(token), token).toBe(true);
    }
    expect(raw.has("lite")).toBe(false);
    expect(copyLintViolations(SG_COPY, registry)).toEqual([]);
  });

  it("rejects Ken Burns phrasing", () => {
    const tainted = {
      ...SG_COPY,
      [SG_MESSAGE_KEYS.FALLBACK_STATIC]: `${SG_COPY.SG_FALLBACK_STATIC} Ken Burns`,
    };
    expect(copyLintViolations(tainted, registry).some((item) => item.includes("ken burns"))).toBe(true);
  });

  it("rejects a currency amount, upgrade, and a registry provider token", () => {
    expect(
      copyLintViolations(
        { ...SG_COPY, [SG_MESSAGE_KEYS.WAITING]: `${SG_COPY.SG_WAITING} $1` },
        registry,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      copyLintViolations(
        { ...SG_COPY, [SG_MESSAGE_KEYS.WAITING]: `${SG_COPY.SG_WAITING} upgrade` },
        registry,
      ).some((item) => item.includes("upgrade")),
    ).toBe(true);
    const provider = registry.lanes?.find((row) => row.providerKey?.includes("replicate"))?.providerKey;
    expect(provider).toBeTruthy();
    expect(
      copyLintViolations(
        { ...SG_COPY, [SG_MESSAGE_KEYS.WAITING]: `${SG_COPY.SG_WAITING} ${provider}` },
        registry,
      ).some((item) => item.includes("registry")),
    ).toBe(true);
  });

  it("covers every stored key the policy can return", () => {
    const unqualified: RegistrySnapshot = { lanes: [lane()] };
    const legacyMissing: RegistrySnapshot = { lanes: [lane({ designation: "NONE" })] };
    const ceiling: RegistrySnapshot = {
      lanes: [
        lane({
          gates: { HERO: "NOT_QUALIFIED", IDENTITY: "NOT_QUALIFIED", NON_IDENTITY: "QUALIFIED" },
        }),
      ],
      regenCeilings: { "draft-cost": 1, "draft-quality": 2, standard: 2, premium: 2 },
    };
    const cases: Array<{ name: string; decision: ReturnType<typeof decide> }> = [
      {
        name: "ORIGINAL",
        decision: decide(cues({ originalCoversSlot: true }), unqualified, openBudget, []),
      },
      {
        name: "dialogue DEFER",
        decision: decide(cues({ shotRole: "dialogue-closeup" }), unqualified, openBudget, []),
      },
      {
        name: "cap DEFER",
        decision: decide(cues(), unqualified, blockedBudget, []),
      },
      {
        name: "retry-blocked DEFER",
        decision: decide(
          cues(),
          unqualified,
          openBudget,
          [{ laneClass: "draft-cost", outcome: "TIMEOUT_UNRECONCILED", classAttemptNo: 1 }],
        ),
      },
      {
        name: "stillOrDefer DEFER NO_QUALIFIED_LANE",
        decision: decide(cues({ sourceStillExists: false }), unqualified, openBudget, []),
      },
      {
        name: "stillOrDefer KEN_BURNS NO_QUALIFIED_LANE",
        decision: decide(
          cues({ sourceStillExists: true, motionNeed: "low" }),
          unqualified,
          openBudget,
          [],
        ),
      },
      {
        name: "stillOrDefer STATIC NO_QUALIFIED_LANE",
        decision: decide(
          cues({ sourceStillExists: true, motionNeed: "none" }),
          unqualified,
          openBudget,
          [],
        ),
      },
      {
        name: "stillOrDefer DEFER CEILING_REACHED",
        decision: decide(
          cues({ sourceStillExists: false }),
          ceiling,
          openBudget,
          [{ laneClass: "draft-cost", outcome: "FAILED", classAttemptNo: 1 }],
        ),
      },
      {
        name: "stillOrDefer KEN_BURNS CEILING_REACHED",
        decision: decide(
          cues({ sourceStillExists: true, motionNeed: "high" }),
          ceiling,
          openBudget,
          [{ laneClass: "draft-cost", outcome: "FAILED", classAttemptNo: 1 }],
        ),
      },
      {
        name: "LEGACY without LEGACY_R1",
        decision: decide(cues({ routingMode: "LEGACY" }), legacyMissing, openBudget, []),
      },
    ];
    const seen = new Set<string>();
    for (const item of cases) {
      expect(item.decision.treatment, item.name).not.toBe("GENERATE");
      expect(item.decision.messageKey, item.name).toBeTruthy();
      expect(SG_COPY[item.decision.messageKey as SgMessageKey], item.name).toBeTruthy();
      seen.add(item.decision.messageKey as string);
      const plan = planRoute(
        { ...cues(), routingMode: item.name === "LEGACY without LEGACY_R1" ? "LEGACY" : "ENFORCED" },
        unqualified,
        openBudget,
        [],
      );
      for (const decision of [plan.applied, plan.shadow]) {
        if (decision.messageKey) {
          expect(SG_COPY[decision.messageKey as SgMessageKey]).toBeTruthy();
          seen.add(decision.messageKey);
        }
      }
    }
    expect(seen.has(SG_MESSAGE_KEYS.FALLBACK_ORIGINAL)).toBe(true);
    expect(seen.has(SG_MESSAGE_KEYS.WAITING)).toBe(true);
    expect(seen.has(SG_MESSAGE_KEYS.CAP_REACHED)).toBe(true);
    expect(seen.has(SG_MESSAGE_KEYS.FAILED_HONEST)).toBe(true);
    expect(seen.has(SG_MESSAGE_KEYS.NO_QUALIFIED_LANE)).toBe(true);
    expect(seen.has(SG_MESSAGE_KEYS.CEILING_REACHED)).toBe(true);
    expect(seen.has(SG_MESSAGE_KEYS.FALLBACK_KEN_BURNS)).toBe(false);
    expect(seen.has(SG_MESSAGE_KEYS.REBUILD_HINT)).toBe(false);
  });

  it("scans production messageKey writes and never stores SG_REBUILD_HINT", () => {
    const root = path.join(process.cwd(), "src/server");
    const files: string[] = [];
    walk(root, files);
    const literal = /messageKey:\s*"(SG_[A-Z0-9_]+)"/g;
    const constant = /SG_MESSAGE_KEYS\.([A-Z0-9_]+)/g;
    const userLiteral = /userMessageKey:\s*"(SG_[A-Z0-9_]+)"/g;
    const found = new Set<string>();
    for (const file of files) {
      if (file.endsWith(`${path.sep}presenter.ts`) || file.endsWith(`${path.sep}messages.ts`)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      expect(source.includes('messageKey: "SG_REBUILD_HINT"'), file).toBe(false);
      expect(source.includes("messageKey: SG_MESSAGE_KEYS.REBUILD_HINT"), file).toBe(false);
      expect(source.includes('userMessageKey: "SG_REBUILD_HINT"'), file).toBe(false);
      expect(source.includes("userMessageKey: SG_MESSAGE_KEYS.REBUILD_HINT"), file).toBe(false);
      for (const match of source.matchAll(literal)) found.add(match[1]!);
      for (const match of source.matchAll(userLiteral)) found.add(match[1]!);
      for (const match of source.matchAll(constant)) {
        const key = SG_MESSAGE_KEYS[match[1] as keyof typeof SG_MESSAGE_KEYS];
        expect(key, `${file} ${match[1]}`).toBeTruthy();
        expect(match[1]).not.toBe("REBUILD_HINT");
        found.add(key);
      }
    }
    for (const key of found) {
      expect(Object.values(SG_MESSAGE_KEYS)).toContain(key);
      expect(SG_COPY[key as SgMessageKey], key).toBeTruthy();
      expect(key).not.toBe(SG_MESSAGE_KEYS.REBUILD_HINT);
    }
    expect(found.has(SG_MESSAGE_KEYS.FAILED_HONEST)).toBe(true);
    expect(found.has(SG_MESSAGE_KEYS.WAITING)).toBe(true);
    expect(found.has(SG_MESSAGE_KEYS.CAP_REACHED)).toBe(true);
    expect(found.has(SG_MESSAGE_KEYS.FALLBACK_KEN_BURNS)).toBe(true);
    expect(found.has(SG_MESSAGE_KEYS.FALLBACK_STATIC)).toBe(true);
  });
});
