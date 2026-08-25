import type { CreativePlan } from "@/server/director/schema";
import type { DirectorInput } from "@/server/director/input";

/**
 * Future self-evaluation boundary. No scores. No invented confidence.
 * Phase 2E records the contract only.
 */
export type DirectorEvaluationFocus =
  | "project_intent"
  | "user_taste"
  | "available_media"
  | "constraints"
  | "narrative_coherence"
  | "pacing"
  | "emotional_objectives";

export type DirectorEvaluationRequest = {
  input: DirectorInput;
  plan: CreativePlan;
  focus: DirectorEvaluationFocus[];
};

export type DirectorEvaluation = {
  status: "NOT_IMPLEMENTED";
  focus: DirectorEvaluationFocus[];
};

export function createDirectorEvaluationBoundary(
  request: DirectorEvaluationRequest,
): DirectorEvaluation {
  return {
    status: "NOT_IMPLEMENTED",
    focus: request.focus,
  };
}

/**
 * Feedback from a future iteration loop. Becomes a TasteSignal (INFERRED)
 * if recorded — never a TastePreference. One film does not rewrite long-term taste.
 */
export type DirectorFeedback = {
  projectId: string;
  kind: "USER_REJECTED_SUGGESTION" | "USER_ACCEPTED_SUGGESTION" | "USER_CHANGED_EDIT";
  note?: string;
};
