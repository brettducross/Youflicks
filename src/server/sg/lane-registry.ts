import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { reportOpsAlert, OpsAlertKind } from "@/lib/ops-alerts";
import {
  GATE_STATUSES,
  LANE_CLASSES,
  gateStatusSchema,
  laneClassSchema,
  routingScopeSchema,
  type GateStatus,
  type LaneClass,
  type RoutingScope,
} from "@/server/sg/constants";

/**
 * SG.3 lane registry v1. Extends the PR-1 rate file.
 * Routing (`decide`) is PR-8. This module only validates, stamps, and
 * answers which lanes are gate-eligible. An invalid document yields zero
 * eligible lanes and an ops alert.
 */

export const DEFAULT_SG_LANE_REGISTRY_PATH = "config/sg-lane-registry.json";

/**
 * Lock §4 resolution tiers. `pro` is a SKU name, not a measured pixel tier.
 * HERO and IDENTITY QUALIFIED fail the 720p floor on `pro` until it is measured.
 */
export const RESOLUTION_TIERS = ["480p", "720p", "768p", "1080p", "pro"] as const;
export type ResolutionTier = (typeof RESOLUTION_TIERS)[number];

const RESOLUTION_RANK: Record<Exclude<ResolutionTier, "pro">, number> = {
  "480p": 480,
  "720p": 720,
  "768p": 768,
  "1080p": 1080,
};

export const AUDIO_MODES = ["OFF", "STRIP"] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];

/**
 * Non-generative processor class. Not a member of LANE_CLASSES.
 * Kept on the separate `processors` array so a generative lane cannot use it.
 */
export const PROCESSOR_LANE_CLASS = "processor" as const;

const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;
const LANE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;
/**
 * Word-bounded, minimum-length secret shapes.
 * A bare "sk-" substring also matches "risk-" and "task-", which must stay legal in rateRef prose.
 */
const SECRET_LIKE =
  /\bsk-[A-Za-z0-9_-]{16,}|\br8_[A-Za-z0-9]{16,}|begin private|\bakia[0-9a-z]{16}\b/i;
const HEX_SHA = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;
/** Printable provider labels only. Rejects whitespace, zero-width, and other non-ASCII. */
export const PROVIDER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060\u00AD]/g;
const TBD_PREFIX = /^tbd\s*:/i;

/**
 * Drop zero-width characters and trim. Interior spaces stay so "TBD :x" still matches the TBD prefix.
 * Shared by the registry schema and requireLiveLane.
 */
export function normalizeProviderKey(providerKey: string): string {
  return providerKey.replace(ZERO_WIDTH, "").trim();
}

/** True when the key is a TBD transport label, including "TBD :x" and a zero-width prefix. */
export function isTbdProviderKey(providerKey: string): boolean {
  return TBD_PREFIX.test(normalizeProviderKey(providerKey));
}

/** The lane id after a TBD prefix, or null when the key is not TBD. */
export function tbdProviderKeyRemainder(providerKey: string): string | null {
  const normalized = normalizeProviderKey(providerKey);
  const match = TBD_PREFIX.exec(normalized);
  if (!match) {
    return null;
  }
  return normalized.slice(match[0].length);
}

const providerKeySchema = z
  .string()
  .min(1)
  .regex(
    PROVIDER_KEY_PATTERN,
    "providerKey must not contain whitespace, zero-width characters, or characters outside [A-Za-z0-9._:/@-]",
  );

const laneIdSchema = z
  .string()
  .regex(LANE_ID_PATTERN, "laneId must match [a-z0-9][a-z0-9.-]*");

const envNameSchema = z
  .string()
  .regex(ENV_VAR_NAME, "gateway env fields must be env var names, not values")
  .refine((name) => !SECRET_LIKE.test(name), "gateway env fields must be env var names, not values");

function isHexSha(token: string): boolean {
  return HEX_SHA.test(token);
}

/** 40-character uppercase-plus-digits token. Not exempted as an env var name. */
function isUpperDigitSecret(token: string): boolean {
  return /^[A-Z0-9]{40}$/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token);
}

function valueLooksSecret(value: string, field: string | number | undefined): boolean {
  if (SECRET_LIKE.test(value)) {
    return true;
  }
  if (field === "evidenceSha256" && /^[a-f0-9]{64}$/.test(value)) {
    return false;
  }
  if (isHexSha(value)) {
    return false;
  }
  if (isUpperDigitSecret(value)) {
    return true;
  }
  if (ENV_VAR_NAME.test(value)) {
    return false;
  }
  const tokens = value.match(/[A-Za-z0-9]{24,}/g) ?? [];
  return tokens.some((token) => {
    if (isHexSha(token)) {
      return false;
    }
    if (isUpperDigitSecret(token)) {
      return true;
    }
    if (ENV_VAR_NAME.test(token)) {
      return false;
    }
    return /[0-9]/.test(token) && /[A-Za-z]/.test(token);
  });
}

function rejectSecretLikeValues(
  value: unknown,
  path: Array<string | number>,
  ctx: { addIssue: (issue: { code: "custom"; message: string; path: Array<string | number> }) => void },
) {
  if (typeof value === "string") {
    if (valueLooksSecret(value, path[path.length - 1])) {
      ctx.addIssue({
        code: "custom",
        message: "registry contains a secret-like value",
        path,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretLikeValues(item, [...path, index], ctx));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      rejectSecretLikeValues(child, [...path, key], ctx);
    }
  }
}

const designationSchema = z.string().superRefine((value, ctx) => {
  if (value === "DEFAULT") {
    ctx.addIssue({ code: "custom", message: "designation DEFAULT is rejected" });
    return;
  }
  if (value !== "NONE" && value !== "LEGACY_R1") {
    ctx.addIssue({
      code: "custom",
      message: "designation must be NONE or LEGACY_R1",
    });
  }
});

const gateRecordSchema = z
  .object({
    status: gateStatusSchema,
    evidenceSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "evidenceSha256 must be a sha256 hex digest")
      .optional(),
    signoffRef: z
      .string()
      .refine((value) => value.trim().length > 0, "signoffRef must be non-blank")
      .optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "gate date must be YYYY-MM-DD")
      .optional(),
  })
  .strict()
  .superRefine((gate, ctx) => {
    if (gate.status !== "QUALIFIED") {
      return;
    }
    if (!gate.evidenceSha256) {
      ctx.addIssue({
        code: "custom",
        message: "QUALIFIED requires evidenceSha256",
        path: ["evidenceSha256"],
      });
    }
    if (!gate.signoffRef) {
      ctx.addIssue({
        code: "custom",
        message: "QUALIFIED requires signoffRef",
        path: ["signoffRef"],
      });
    }
  });

const gatesSchema = z
  .object({
    HERO: gateRecordSchema,
    IDENTITY: gateRecordSchema,
    NON_IDENTITY: gateRecordSchema,
  })
  .strict();

export const generativeLaneSchema = z
  .object({
    laneId: laneIdSchema,
    laneClass: laneClassSchema,
    providerKey: providerKeySchema,
    modelId: z.string().min(1),
    gateway: z
      .object({
        baseUrlEnv: envNameSchema,
        apiKeyEnv: envNameSchema,
      })
      .strict(),
    resolutionTier: z.enum(RESOLUTION_TIERS),
    usdPerSecond: z.number().finite().nonnegative(),
    rateRef: z.string().min(1),
    clipDurationS: z.number().positive(),
    supportedDurationsS: z.array(z.number().positive()).min(1),
    billingGranularityS: z.number().positive(),
    failuresBillable: z.boolean(),
    audioMode: z.enum(AUDIO_MODES),
    enabled: z.boolean(),
    designation: designationSchema,
    gates: gatesSchema,
  })
  .strict()
  .superRefine((lane, ctx) => {
    if (isTbdProviderKey(lane.providerKey)) {
      if (lane.enabled) {
        ctx.addIssue({
          code: "custom",
          message: "enabled lane must have a non-TBD providerKey",
          path: ["providerKey"],
        });
      }
      const remainder = tbdProviderKeyRemainder(lane.providerKey);
      if (remainder !== lane.laneId) {
        ctx.addIssue({
          code: "custom",
          message: "TBD providerKey is allowed only as TBD:<laneId> while enabled is false",
          path: ["providerKey"],
        });
      }
    }
    if (lane.enabled && !(lane.usdPerSecond > 0)) {
      ctx.addIssue({
        code: "custom",
        message: "enabled lane requires usdPerSecond > 0",
        path: ["usdPerSecond"],
      });
    }
    const durationListed = lane.supportedDurationsS.some(
      (duration) => Math.abs(duration - lane.clipDurationS) < 1e-9,
    );
    if (!durationListed) {
      ctx.addIssue({
        code: "custom",
        message: "clipDurationS must be one of supportedDurationsS",
        path: ["clipDurationS"],
      });
    }
    for (const scope of ["HERO", "IDENTITY"] as const) {
      const gate = lane.gates[scope];
      if (gate.status === "QUALIFIED" && !resolutionMeets720pFloor(lane.resolutionTier)) {
        ctx.addIssue({
          code: "custom",
          message: `${scope} QUALIFIED requires resolutionTier >= 720p`,
          path: ["gates", scope, "status"],
        });
      }
    }
  });

const processorSchema = z
  .object({
    laneId: laneIdSchema,
    laneClass: z.literal(PROCESSOR_LANE_CLASS),
    providerKey: providerKeySchema,
    modelId: z.string().min(1),
    resolutionTier: z.literal("output-profile"),
    usdPerSecond: z.literal(0),
    rateRef: z.string().min(1),
    duration: z.literal("slot-derived"),
    audioMode: z.enum(AUDIO_MODES),
    enabled: z.boolean(),
    generative: z.literal(false),
  })
  .strict();

const regenCeilingsSchema = z
  .object({
    "draft-cost": z.literal(3),
    "draft-quality": z.literal(2),
    standard: z.literal(2),
    premium: z.literal(2),
  })
  .strict();

const classOrderSchema = z.tuple([
  z.literal("draft-cost"),
  z.literal("draft-quality"),
  z.literal("standard"),
  z.literal("premium"),
]);

export const laneRegistryFileSchema = z
  .object({
    registryVersion: z.string().min(1),
    thresholdsVersion: z.string().min(1),
    regenCeilings: regenCeilingsSchema,
    classOrder: classOrderSchema,
    lanes: z.array(generativeLaneSchema).min(1),
    processors: z.array(processorSchema),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    for (const [index, lane] of doc.lanes.entries()) {
      if (ids.has(lane.laneId)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate laneId ${lane.laneId}`,
          path: ["lanes", index, "laneId"],
        });
      }
      ids.add(lane.laneId);
    }
    for (const [index, processor] of doc.processors.entries()) {
      if (ids.has(processor.laneId)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate laneId ${processor.laneId}`,
          path: ["processors", index, "laneId"],
        });
      }
      ids.add(processor.laneId);
    }
    const legacy = doc.lanes.filter((lane) => lane.designation === "LEGACY_R1");
    if (legacy.length > 1) {
      ctx.addIssue({
        code: "custom",
        message: "at most one LEGACY_R1 lane",
        path: ["lanes"],
      });
    }
    for (const lane of legacy) {
      if (!lane.enabled || isTbdProviderKey(lane.providerKey)) {
        ctx.addIssue({
          code: "custom",
          message: "LEGACY_R1 lane must be enabled with a real providerKey",
          path: ["lanes"],
        });
      }
    }
    const baseUrlEnvs = new Set<string>();
    const apiKeyEnvs = new Set<string>();
    for (const [index, lane] of doc.lanes.entries()) {
      if (baseUrlEnvs.has(lane.gateway.baseUrlEnv)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate gateway.baseUrlEnv ${lane.gateway.baseUrlEnv}`,
          path: ["lanes", index, "gateway", "baseUrlEnv"],
        });
      }
      baseUrlEnvs.add(lane.gateway.baseUrlEnv);
      if (apiKeyEnvs.has(lane.gateway.apiKeyEnv)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate gateway.apiKeyEnv ${lane.gateway.apiKeyEnv}`,
          path: ["lanes", index, "gateway", "apiKeyEnv"],
        });
      }
      apiKeyEnvs.add(lane.gateway.apiKeyEnv);
    }
    rejectSecretLikeValues(doc, [], ctx);
  });

export type RegistryLane = z.infer<typeof generativeLaneSchema>;
export type RegistryProcessor = z.infer<typeof processorSchema>;
export type SgLaneRegistry = z.infer<typeof laneRegistryFileSchema>;

export type RegistryStamp = {
  registryVersion: string;
  registrySha256: string;
};

export class LaneRegistryError extends Error {
  readonly code = "LANE_REGISTRY_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "LaneRegistryError";
  }
}

export function resolutionMeets720pFloor(tier: ResolutionTier): boolean {
  if (tier === "pro") {
    return false;
  }
  return RESOLUTION_RANK[tier] >= 720;
}

export function parseLaneRegistry(data: unknown, source = "registry"): SgLaneRegistry {
  const result = laneRegistryFileSchema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "registry"}: ${issue.message}`)
      .join("; ");
    throw new LaneRegistryError(`Lane registry at ${source} is invalid. ${detail}`);
  }
  return result.data;
}

export function loadSgLaneRegistry(path = DEFAULT_SG_LANE_REGISTRY_PATH): SgLaneRegistry {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new LaneRegistryError(
      `Lane registry at ${path} could not be read (${error instanceof Error ? error.message : "unknown"}).`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new LaneRegistryError(`Lane registry at ${path} is not valid JSON.`);
  }
  return parseLaneRegistry(parsed, path);
}

/**
 * In-file registryVersion plus the sha256 of the file bytes.
 * Both fields stay empty unless the bytes parse and validate. An empty
 * stamp means the registry is unavailable (missing, unreadable, or invalid)
 * and fails closed. Callers must not substitute a placeholder label.
 */
export function stampRegistryBytes(raw: Buffer): RegistryStamp {
  const empty: RegistryStamp = { registryVersion: "", registrySha256: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    return empty;
  }
  const result = laneRegistryFileSchema.safeParse(parsed);
  if (!result.success) {
    return empty;
  }
  return {
    registryVersion: result.data.registryVersion,
    registrySha256: createHash("sha256").update(raw).digest("hex"),
  };
}

export function suspendedLaneIdsFromEnv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Runtime override SG_LANES_SUSPENDED. The only status this writes is SUSPENDED.
 * Lanes not listed are unchanged, including a QUALIFIED gate.
 */
export function applyLaneSuspension(
  lanes: readonly RegistryLane[],
  suspendedIds: readonly string[],
): RegistryLane[] {
  const ids = new Set(suspendedIds);
  return lanes.map((lane) => {
    if (!ids.has(lane.laneId)) {
      return lane;
    }
    return {
      ...lane,
      gates: {
        HERO: { ...lane.gates.HERO, status: "SUSPENDED" },
        IDENTITY: { ...lane.gates.IDENTITY, status: "SUSPENDED" },
        NON_IDENTITY: { ...lane.gates.NON_IDENTITY, status: "SUSPENDED" },
      },
    };
  });
}

function laneIsEligible(lane: RegistryLane, requiredScopes: readonly RoutingScope[]): boolean {
  if (!lane.enabled || isTbdProviderKey(lane.providerKey)) {
    return false;
  }
  return requiredScopes.every((scope) => lane.gates[scope].status === "QUALIFIED");
}

export type EligibleLaneQuery = {
  requiredScopes: readonly string[];
  path?: string;
  registry?: SgLaneRegistry;
  /** When omitted, SG_LANES_SUSPENDED is read. Pass [] to ignore the env. */
  suspendedLaneIds?: readonly string[];
};

/**
 * Gate-eligible generative lanes. Invalid registry → [] and an ops alert.
 * Health, ceilings, and budget are PR-8 and are not applied here.
 */
const registryAlertedAt = new Map<string, number>();
const REGISTRY_ALERT_WINDOW_MS = 60_000;

/** Tests call this so a prior invalid file cannot suppress a later one. */
export function resetLaneRegistryAlertDebounce(): void {
  registryAlertedAt.clear();
}

function alertRegistryInvalid(source: string, message: string): void {
  const key = `${source}\n${message}`;
  const now = Date.now();
  const previous = registryAlertedAt.get(key);
  if (previous !== undefined && now - previous < REGISTRY_ALERT_WINDOW_MS) {
    return;
  }
  registryAlertedAt.set(key, now);
  void reportOpsAlert({
    kind: OpsAlertKind.LANE_REGISTRY_INVALID,
    message: "Lane registry is invalid. No lane is eligible.",
    context: { path: source, error: message },
  });
}

/**
 * SG_LANES_SUSPENDED ids that are not lanes or processors. A matching id
 * is silent. The unknown ids are the alert context.
 */
export function reportUnknownSuspendedLanes(
  registry: Pick<SgLaneRegistry, "lanes" | "processors">,
  suspendedIds: readonly string[],
): void {
  const known = new Set<string>([
    ...registry.lanes.map((lane) => lane.laneId),
    ...registry.processors.map((processor) => processor.laneId),
  ]);
  const unknown = suspendedIds.filter((id) => !known.has(id));
  if (unknown.length === 0) {
    return;
  }
  void reportOpsAlert({
    kind: OpsAlertKind.SG_LANES_SUSPENDED_UNKNOWN,
    message: "SG_LANES_SUSPENDED names lanes that are not in the registry.",
    context: { unknownLaneIds: unknown },
  });
}

export function listEligibleLanes(input: EligibleLaneQuery): RegistryLane[] {
  const scopes = z.array(routingScopeSchema).min(1).safeParse([...input.requiredScopes]);
  if (!scopes.success || scopes.data.length === 0) {
    return [];
  }
  let registry: SgLaneRegistry;
  const source = input.path?.trim() || DEFAULT_SG_LANE_REGISTRY_PATH;
  try {
    registry = input.registry ?? loadSgLaneRegistry(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lane registry is invalid.";
    alertRegistryInvalid(source, message);
    return [];
  }
  const suspended =
    input.suspendedLaneIds ?? suspendedLaneIdsFromEnv(process.env.SG_LANES_SUSPENDED);
  reportUnknownSuspendedLanes(registry, suspended);
  return applyLaneSuspension(registry.lanes, suspended).filter((lane) =>
    laneIsEligible(lane, scopes.data),
  );
}

export const LOCKED_LANE_CLASSES: readonly LaneClass[] = LANE_CLASSES;
export const LOCKED_GATE_STATUSES: readonly GateStatus[] = GATE_STATUSES;
