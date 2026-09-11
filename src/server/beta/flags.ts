import "server-only";

import { env } from "@/lib/env";

export {
  AI_CONSENT_POLICY_VERSION,
  BETA_DEFAULT_MAX_JOBS,
  BETA_DEFAULT_MAX_SPEND_USD,
  SHARE_LINK_MINT_KIND,
  SHARE_LINK_MINTS_PER_HOUR,
} from "@/server/beta/defaults";

/**
 * Temporary closed-beta front door. Fail-closed in production when unset.
 * Explicit BETA_INVITE_ONLY=false restores public free-tier signup.
 */
export function inviteOnlyEnabled(
  nodeEnv: string = env.NODE_ENV,
  flag: boolean | undefined = env.BETA_INVITE_ONLY,
): boolean {
  return resolveInviteOnly(nodeEnv, flag);
}

/** `flag === undefined` means unset (fail-closed in production). */
export function resolveInviteOnly(nodeEnv: string, flag: boolean | undefined): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  return nodeEnv === "production";
}

export function isHttpVisionConfigured(
  bag: {
    ANALYSIS_HTTP_BASE_URL?: string;
    ANALYSIS_HTTP_API_KEY?: string;
    ANALYSIS_HTTP_MODEL?: string;
  } = env,
): boolean {
  return Boolean(
    bag.ANALYSIS_HTTP_BASE_URL?.trim() &&
      bag.ANALYSIS_HTTP_API_KEY?.trim() &&
      bag.ANALYSIS_HTTP_MODEL?.trim(),
  );
}

export function isHttpAssetConfigured(
  bag: {
    ASSET_HTTP_BASE_URL?: string;
    ASSET_HTTP_API_KEY?: string;
    ASSET_HTTP_MODEL?: string;
  } = env,
): boolean {
  return Boolean(
    bag.ASSET_HTTP_BASE_URL?.trim() &&
      bag.ASSET_HTTP_API_KEY?.trim() &&
      bag.ASSET_HTTP_MODEL?.trim(),
  );
}

export function isHttpRendererConfigured(
  bag: {
    RENDER_HTTP_BASE_URL?: string;
    RENDER_HTTP_API_KEY?: string;
    RENDER_HTTP_MODEL?: string;
  } = env,
): boolean {
  return Boolean(
    bag.RENDER_HTTP_BASE_URL?.trim() &&
      bag.RENDER_HTTP_API_KEY?.trim() &&
      bag.RENDER_HTTP_MODEL?.trim(),
  );
}

export function vendorEgressConfigured(): boolean {
  return isHttpVisionConfigured() || isHttpAssetConfigured() || isHttpRendererConfigured();
}

export function logEmailForbiddenInProductionBeta(
  nodeEnv: string = env.NODE_ENV,
  emailDriver: string = env.EMAIL_DRIVER,
  inviteOnly: boolean = inviteOnlyEnabled(),
): boolean {
  return nodeEnv === "production" && inviteOnly && emailDriver === "log";
}
