/**
 * Map a YouFlicks generate input into a text prompt.
 * Uses only creative hints / brief fields. No credentials, storage keys, or vendor JSON.
 */
export function promptFromGenerateRequest(input: {
  kind: string;
  role: string;
  creativeHints?: Record<string, unknown>;
  projectIntent?: Record<string, unknown>;
  effectiveBrief?: Record<string, unknown>;
}): string {
  const hints = asRecord(input.creativeHints);
  const intent = asRecord(input.projectIntent);
  const brief = asRecord(input.effectiveBrief);
  const parts = [
    pick(hints, "scenePurpose"),
    pick(hints, "rolePurpose"),
    pick(hints, "sceneMood") ?? pick(brief, "mood") ?? pick(intent, "mood"),
    pick(brief, "visualStyle") ?? pick(intent, "visualStyle") ?? pick(hints, "briefVisualStyle"),
    pick(brief, "purpose") ?? pick(intent, "purpose"),
    pick(brief, "explicitInstructions") ?? pick(intent, "explicitInstructions"),
  ].filter((part): part is string => Boolean(part));

  const lead =
    input.kind === "VIDEO_CLIP"
      ? `Short cinematic clip for role "${input.role}".`
      : `Generated ${input.kind.toLowerCase()} for role "${input.role}".`;
  return [lead, ...parts].join(" ");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pick(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
