import { ANALYSIS_SCHEMA_VERSION, peopleAnalysisSchema } from "@/server/analysis/schema";
import {
  IDENTITY_STATES,
  MOTION_NEEDS,
  ROUTING_SCOPES,
  SHOT_ROLES,
  type IdentityState,
  type MotionNeed,
  type RoutingScope,
  type ShotRole,
  type Treatment,
} from "@/server/sg/constants";
import { assertIdentityEvidence } from "@/server/sg/identity-evidence";

/**
 * ShotCueExtractor (SG.1 / PR-6). Pure: no I/O.
 * It does not write Story, Timeline, or CreativePlan, and it does not route.
 * E11 is open: stored evidence is the existing count/boolean allowlist only.
 * E12 is open: a dialogue close-up is recorded as shotRole "dialogue-closeup"
 * together with the locked interim set. This function does not pick one of
 * ORIGINAL, STATIC, or KEN_BURNS. Routing stays in PR-8.
 */

export const HERO_DRAMATIC_FUNCTIONS = ["climax", "turning", "inciting"] as const;

/** Locked interim set (PR-6). Not a selection. E12 decides whether it can be lifted. */
export const DIALOGUE_INTERIM_TREATMENTS = ["ORIGINAL", "STATIC", "KEN_BURNS"] as const satisfies readonly Treatment[];

const ANALYSIS_COMPLETED = "COMPLETED";

/** Postgres INTEGER upper bound. A larger slot duration makes Prisma throw. */
const MAX_SLOT_DURATION_MS = 2_147_483_647;

const MOTION_NONE = new Set(["none", "static", "locked", "still", "fixed", "tripod"]);
const MOTION_LOW = new Set(["low", "pan", "tilt", "slow", "dolly", "push", "drift", "gentle"]);
const MOTION_HIGH = new Set(["high", "handheld", "tracking", "crash", "whip", "aerial", "drone", "fast", "zoom"]);

export class ShotCueError extends Error {
  readonly code = "SHOT_CUE_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "ShotCueError";
  }
}

export type CueScene = {
  id: string;
  dramaticFunction: string;
  purpose: string;
  dialogueOutline?: string;
  mediaRoles: ReadonlyArray<{ role: string; purpose?: string }>;
};

export type CueUnmetRole = {
  role: string;
  storySceneId?: string;
  reason?: string;
};

/**
 * Start-frame analysis reduced to the lock's inputs.
 * Person ids, location strings, embeddings, and crops are not retained here
 * except location strings, which the extractor reads and then drops.
 */
export type ShotCueAnalysis = {
  /** MediaAnalysis.status. Null when there is no analysis row. */
  status: string | null;
  /** MediaAsset.analysisStatus. A QUEUED or PROCESSING re-analysis makes the row stale. */
  assetStatus: string | null;
  faceDetected: boolean;
  faceCount: number;
  /** people.count when it is an integer in range; otherwise null (not zero). */
  peopleCount: number | null;
  recurringPersonCount: number;
  cameraMovement: string | null;
  locations: readonly string[];
  /**
   * True only when the people section parsed under peopleAnalysisSchema,
   * ids are non-blank strings, and faceDetected is boolean wherever present.
   * A failed parse is never ABSENT.
   */
  peopleParsed: boolean;
  /** True when people.people lists at least one person. Count 0 plus a person is UNKNOWN. */
  personListed: boolean;
};

export type SceneEmphasisCue = {
  kind: string;
  subject?: string;
  detail?: Record<string, unknown>;
};

export type ShotCueInput = {
  scene: CueScene | null;
  unmetRole: CueUnmetRole;
  /** Matching video.primary clip duration, when one exists. */
  slotDurationMs: number | null;
  analysis: ShotCueAnalysis | null;
  sceneEmphasis: readonly SceneEmphasisCue[];
};

export type ShotCueEvidence = {
  faceCount: number;
  faceDetected: boolean;
  recurringPersonCount: number;
  analysisCompleted: boolean;
};

export type ExtractedShotCues = {
  hero: boolean;
  shotRole: ShotRole;
  identityState: IdentityState;
  scope: RoutingScope;
  requiredScopes: RoutingScope[];
  identityEvidence: ShotCueEvidence;
  motionNeed: MotionNeed | null;
  slotDurationMs: number | null;
  /** True when the E12 interim applies. Not a chosen treatment. */
  dialogueInterim: boolean;
  interimTreatments: readonly Treatment[] | null;
};

export type PersistableShotCues = {
  scope: RoutingScope;
  requiredScopes: RoutingScope[];
  identityState: IdentityState;
  shotRole: ShotRole;
  motionNeed: MotionNeed | null;
  slotDurationMs: number | null;
  identityEvidence: Record<string, unknown>;
};

type TimelineClipTiming = {
  trackKey: string;
  mediaRole?: string;
  storySceneId?: string;
  timelineStartMs: number;
  timelineEndMs: number;
};

export function slotDurationMsForRole(
  clips: readonly TimelineClipTiming[],
  role: string,
  storySceneId?: string | null,
): number | null {
  const matches = clips.filter((clip) => {
    if (clip.trackKey !== "video.primary") {
      return false;
    }
    if (clip.mediaRole !== role) {
      return false;
    }
    if (storySceneId && clip.storySceneId !== storySceneId) {
      return false;
    }
    return true;
  });
  if (matches.length === 0) {
    return null;
  }
  const clip = matches.reduce((earliest, item) =>
    item.timelineStartMs < earliest.timelineStartMs ? item : earliest,
  );
  const duration = clip.timelineEndMs - clip.timelineStartMs;
  if (!isSlotDuration(duration)) {
    return null;
  }
  return duration;
}

export function requiredScopesFor(identityState: IdentityState, hero: boolean): RoutingScope[] {
  const scopes: RoutingScope[] = [];
  if (hero) {
    scopes.push("HERO");
  }
  scopes.push(identityState === "ABSENT" ? "NON_IDENTITY" : "IDENTITY");
  return scopes;
}

export function primaryScopeFor(scopes: readonly RoutingScope[]): RoutingScope {
  if (scopes.includes("HERO")) {
    return "HERO";
  }
  if (scopes.includes("IDENTITY")) {
    return "IDENTITY";
  }
  return "NON_IDENTITY";
}

/**
 * Reduce a MediaAnalysis payload to counts and booleans.
 * ABSENT is not decided here. A people section that does not parse is marked
 * unparsed so identity stays UNKNOWN. Person ids, embeddings, crops, URLs,
 * and raw location text are not copied into the returned evidence. Location
 * strings are returned only so the extractor can prove it does not persist them.
 */
export function readAnalysisFields(
  status: string | null,
  payload: unknown,
  assetStatus: string | null = status,
): ShotCueAnalysis {
  const root = asRecord(payload);
  const visual = asRecord(root?.visual);
  const cameraMovement = readCameraMovement(visual?.cameraMovement ?? root?.cameraMovement);
  const locations = readLocations(visual?.locations ?? root?.locations);
  const parsed = parsePeopleSection(root);
  if (!parsed.ok) {
    return {
      status,
      assetStatus,
      faceDetected: false,
      faceCount: 0,
      peopleCount: null,
      recurringPersonCount: 0,
      cameraMovement,
      locations,
      peopleParsed: false,
      personListed: false,
    };
  }
  return {
    status,
    assetStatus,
    faceDetected: parsed.faceDetected,
    faceCount: capCount(parsed.faceCount),
    peopleCount: parsed.peopleCount,
    recurringPersonCount: capCount(parsed.recurringPersonCount),
    cameraMovement,
    locations,
    peopleParsed: true,
    personListed: parsed.personListed,
  };
}

export function extractShotCues(input: ShotCueInput): ExtractedShotCues {
  const identityState = identityStateFrom(input.analysis);
  const hero = isHero(input.scene, input.sceneEmphasis);
  const dialogueInterim = isDialogueCloseup(input.scene, identityState);
  const requiredScopes = requiredScopesFor(identityState, hero);
  const scope = primaryScopeFor(requiredScopes);
  const evidence = evidenceFor(input.analysis);
  const extracted: ExtractedShotCues = {
    hero,
    shotRole: shotRoleFor(input, hero, dialogueInterim),
    identityState,
    scope,
    requiredScopes,
    identityEvidence: evidence,
    motionNeed: motionNeedFrom(input.analysis?.cameraMovement ?? null),
    slotDurationMs: normalizeDuration(input.slotDurationMs),
    dialogueInterim,
    interimTreatments: dialogueInterim ? [...DIALOGUE_INTERIM_TREATMENTS] : null,
  };
  assertNoForbiddenCueKeys(extracted);
  return extracted;
}

export function persistableShotCues(cues: ExtractedShotCues): PersistableShotCues {
  return assertPersistableCues({
    scope: cues.scope,
    requiredScopes: cues.requiredScopes,
    identityState: cues.identityState,
    shotRole: cues.shotRole,
    motionNeed: cues.motionNeed,
    slotDurationMs: cues.slotDurationMs,
    identityEvidence: cues.identityEvidence,
  });
}

/**
 * Write-boundary check used by ensureSlot. Rejects UNKNOWN → NON_IDENTITY
 * and any identityEvidence outside the closed allowlist.
 */
export function assertPersistableCues(value: {
  scope: string;
  requiredScopes: readonly string[];
  identityState: string;
  shotRole: string;
  motionNeed: string | null;
  slotDurationMs: number | null;
  identityEvidence: unknown;
}): PersistableShotCues {
  if (!isOneOf(value.identityState, IDENTITY_STATES)) {
    throw new ShotCueError("identityState is outside PRESENT, ABSENT, and UNKNOWN.");
  }
  if (!isOneOf(value.scope, ROUTING_SCOPES)) {
    throw new ShotCueError("scope is outside HERO, IDENTITY, and NON_IDENTITY.");
  }
  if (!isOneOf(value.shotRole, SHOT_ROLES)) {
    throw new ShotCueError("shotRole is outside the cue vocabulary.");
  }
  if (value.motionNeed !== null && !isOneOf(value.motionNeed, MOTION_NEEDS)) {
    throw new ShotCueError("motionNeed is outside none, low, and high.");
  }
  if (value.slotDurationMs !== null && !isSlotDuration(value.slotDurationMs)) {
    throw new ShotCueError("slotDurationMs must be a positive integer up to 2147483647 or null.");
  }
  if (!Array.isArray(value.requiredScopes) || value.requiredScopes.length === 0) {
    throw new ShotCueError("requiredScopes must be a non-empty scope set.");
  }
  const requiredScopes: RoutingScope[] = [];
  for (const scope of value.requiredScopes) {
    if (!isOneOf(scope, ROUTING_SCOPES)) {
      throw new ShotCueError("requiredScopes contains a value outside the D3 set.");
    }
    if (!requiredScopes.includes(scope)) {
      requiredScopes.push(scope);
    }
  }
  const identityState = value.identityState;
  const hero = requiredScopes.includes("HERO") || value.scope === "HERO";
  const expected = requiredScopesFor(identityState, hero);
  if (!sameScopes(requiredScopes, expected)) {
    throw new ShotCueError("requiredScopes do not match the identity state and hero cue.");
  }
  const scope = primaryScopeFor(expected);
  if (value.scope !== scope) {
    throw new ShotCueError("scope must be the primary required scope.");
  }
  if (identityState !== "ABSENT" && (scope === "NON_IDENTITY" || requiredScopes.includes("NON_IDENTITY"))) {
    throw new ShotCueError("UNKNOWN identity must not map to NON_IDENTITY.");
  }
  if (value.shotRole === "hero" && !requiredScopes.includes("HERO")) {
    throw new ShotCueError("shotRole hero requires the HERO scope.");
  }
  if (value.shotRole === "dialogue-closeup" && identityState === "ABSENT") {
    throw new ShotCueError("A dialogue close-up cannot have ABSENT identity.");
  }
  const identityEvidence = assertIdentityEvidence(value.identityEvidence);
  return {
    scope,
    requiredScopes: expected,
    identityState,
    shotRole: value.shotRole,
    motionNeed: value.motionNeed,
    slotDurationMs: value.slotDurationMs,
    identityEvidence,
  };
}

/**
 * ABSENT must be positively proven. Every other case is UNKNOWN.
 * PRESENT is a parsed face or a parsed non-blank recurring id, and only
 * while both the analysis row and the asset are COMPLETED.
 */
function identityStateFrom(analysis: ShotCueAnalysis | null): IdentityState {
  if (!analysisProved(analysis)) {
    return "UNKNOWN";
  }
  if (analysis.faceDetected || analysis.recurringPersonCount > 0) {
    return "PRESENT";
  }
  if (analysis.peopleCount === 0 && !analysis.personListed && analysis.recurringPersonCount === 0) {
    return "ABSENT";
  }
  return "UNKNOWN";
}

function evidenceFor(analysis: ShotCueAnalysis | null): ShotCueEvidence {
  if (!analysisProved(analysis)) {
    return {
      faceCount: 0,
      faceDetected: false,
      recurringPersonCount: 0,
      analysisCompleted: false,
    };
  }
  return {
    faceCount: capCount(analysis.faceCount),
    faceDetected: analysis.faceDetected,
    recurringPersonCount: capCount(analysis.recurringPersonCount),
    analysisCompleted: true,
  };
}

function analysisProved(analysis: ShotCueAnalysis | null): analysis is ShotCueAnalysis {
  return (
    !!analysis &&
    analysis.status === ANALYSIS_COMPLETED &&
    analysis.assetStatus === ANALYSIS_COMPLETED &&
    analysis.peopleParsed
  );
}

function isHero(scene: CueScene | null, emphasis: readonly SceneEmphasisCue[]): boolean {
  if (!scene) {
    return false;
  }
  if ((HERO_DRAMATIC_FUNCTIONS as readonly string[]).includes(scene.dramaticFunction)) {
    return true;
  }
  return emphasis.some((decision) => decisionNamesScene(decision, scene.id));
}

function decisionNamesScene(decision: SceneEmphasisCue, sceneId: string): boolean {
  if (decision.kind !== "scene_emphasis") {
    return false;
  }
  return namedSceneIds(decision).includes(sceneId);
}

function namedSceneIds(decision: SceneEmphasisCue): string[] {
  const ids: string[] = [];
  pushId(ids, decision.subject);
  const detail = decision.detail;
  if (!detail) {
    return ids;
  }
  pushId(ids, detail.storySceneId);
  pushId(ids, detail.sceneId);
  pushIdList(ids, detail.storySceneIds);
  pushIdList(ids, detail.sceneIds);
  return ids;
}

function isDialogueCloseup(scene: CueScene | null, identityState: IdentityState): boolean {
  if (!scene) {
    return false;
  }
  const outline = scene.dialogueOutline?.trim() ?? "";
  if (outline.length === 0) {
    return false;
  }
  return identityState === "PRESENT" || identityState === "UNKNOWN";
}

function shotRoleFor(input: ShotCueInput, hero: boolean, dialogueInterim: boolean): ShotRole {
  if (dialogueInterim) {
    return "dialogue-closeup";
  }
  if (hero) {
    return "hero";
  }
  const token = input.unmetRole.role.trim().toLowerCase();
  const dramaticFunction = input.scene?.dramaticFunction;
  if (token.includes("transition")) {
    return "transition";
  }
  if (token.includes("establish")) {
    return "establishing";
  }
  if (token.includes("insert") || token.includes("cutaway") || token.includes("detail")) {
    return "insert";
  }
  if (dramaticFunction === "punctuation") {
    return "transition";
  }
  return "other";
}

function motionNeedFrom(cameraMovement: string | null): MotionNeed | null {
  if (!cameraMovement) {
    return null;
  }
  const token = cameraMovement.trim().toLowerCase();
  if (MOTION_NONE.has(token)) {
    return "none";
  }
  if (MOTION_LOW.has(token)) {
    return "low";
  }
  if (MOTION_HIGH.has(token)) {
    return "high";
  }
  return null;
}

const FORBIDDEN_CUE_KEYS = new Set([
  "embedding",
  "embeddings",
  "crop",
  "crops",
  "faceVector",
  "faceVectors",
  "url",
  "urls",
  "recurringPersonIds",
  "locations",
  "usd",
  "usdPerSecond",
  "usdPerS",
  "estimatedUsd",
  "actualUsd",
  "billedSeconds",
  "costUnits",
  "engineCost",
]);

function assertNoForbiddenCueKeys(value: unknown) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenCueKeys(item);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CUE_KEYS.has(key)) {
      throw new ShotCueError("Cue output retained a forbidden field.");
    }
    assertNoForbiddenCueKeys(child);
  }
}

type ParsedPeople = {
  ok: true;
  faceDetected: boolean;
  faceCount: number;
  peopleCount: number | null;
  recurringPersonCount: number;
  personListed: boolean;
};

/**
 * Positive parse of the people section. Failure is not an empty room:
 * the caller must treat it as UNKNOWN.
 */
function parsePeopleSection(root: Record<string, unknown> | null): ParsedPeople | { ok: false } {
  if (!root || !Object.hasOwn(root, "people")) {
    return { ok: false };
  }
  if (Object.hasOwn(root, "analysisSchemaVersion") && root.analysisSchemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    return { ok: false };
  }
  const parsed = peopleAnalysisSchema.safeParse(root.people);
  if (!parsed.success) {
    return { ok: false };
  }
  const people = asRecord(root.people);
  if (!people) {
    return { ok: false };
  }
  if (Object.hasOwn(people, "faceDetected") && typeof people.faceDetected !== "boolean") {
    return { ok: false };
  }
  const personList = parsed.data.people ?? [];
  for (const person of personList) {
    if (person.anonymousPersonId.trim().length === 0) {
      return { ok: false };
    }
  }
  const recurring = parsed.data.recurringPersonIds ?? [];
  for (const id of recurring) {
    if (id.trim().length === 0) {
      return { ok: false };
    }
  }
  let faceCount = 0;
  for (const person of personList) {
    if (person.faceDetected === true) {
      faceCount += 1;
    }
  }
  if (faceCount === 0 && people.faceDetected === true) {
    faceCount = 1;
  }
  return {
    ok: true,
    faceDetected: faceCount > 0,
    faceCount,
    peopleCount: readPeopleCount(parsed.data.count),
    recurringPersonCount: recurring.length,
    personListed: personList.length > 0,
  };
}

function readPeopleCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10_000) {
    return null;
  }
  return value;
}

function readCameraMovement(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readLocations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const locations: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      locations.push(item.trim());
    }
  }
  return locations;
}

function isSlotDuration(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_SLOT_DURATION_MS;
}

function normalizeDuration(value: number | null): number | null {
  if (value === null || !isSlotDuration(value)) {
    return null;
  }
  return value;
}

function capCount(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    return 0;
  }
  return Math.min(value, 10_000);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function pushId(ids: string[], value: unknown) {
  if (typeof value === "string" && value.trim().length > 0) {
    ids.push(value.trim());
  }
}

function pushIdList(ids: string[], value: unknown) {
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    pushId(ids, item);
  }
}

function sameScopes(left: readonly RoutingScope[], right: readonly RoutingScope[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return right.every((scope) => left.includes(scope));
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}
