/**
 * Generic English tokens that the identifier split actually produces from
 * config/sg-lane-registry.json. They are not vendor or model names.
 * `lite` is absent on purpose: veo31lite keeps the leading letters `veo`
 * and the whole token `veo31lite`, so `lite` is never a token.
 */
export const EXCLUDED_GENERIC_TOKENS = ["video", "quality", "cost", "fast", "pro", "audio", "off", "tbd"] as const;

const KEN_BURNS_PHRASES = ["ken burns", "kenburns"];

export type RegistryNameSource = {
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

export function registryTokens(registry: RegistryNameSource): Set<string> {
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
