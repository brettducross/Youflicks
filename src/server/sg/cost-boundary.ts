/**
 * Fulfillment-economics and engine-cost keys. The creative word "cost" is not in this set.
 * A walker over CreativePlan, Story, and Timeline must not find these keys.
 */
export const COST_FIELD_KEYS = [
  "usd",
  "usdPerSecond",
  "usdPerS",
  "estimatedUsd",
  "actualUsd",
  "reservedUsd",
  "spendUsd",
  "committedUsd",
  "unreconciledUsd",
  "billedSeconds",
  "actualBilledSeconds",
  "estimatedBilledSeconds",
  "reservedSeconds",
  "committedSeconds",
  "unreconciledBilledSeconds",
  "reservedBilledSeconds",
  "aiVideoSeconds",
  "spendCapUsd",
  "costUnits",
  "engineCost",
  "costKind",
  "usageEvent",
] as const;

const COST_FIELD_KEY_SET = new Set<string>(COST_FIELD_KEYS);

/** Paths of cost or USD keys. Empty means the value does not carry metering fields. */
export function walkCostFieldPaths(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  walk(value, path, hits);
  return hits;
}

function walk(value: unknown, path: string, hits: string[]) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, hits));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (COST_FIELD_KEY_SET.has(key)) {
      hits.push(childPath);
    }
    walk(child, childPath, hits);
  }
}
