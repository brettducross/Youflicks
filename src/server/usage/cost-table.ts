/**
 * Internal ops cost units. Never imported by Director / Story / Timeline
 * adapters. Not currency. Not a CreativePlan field.
 */
export const OPS_COST_UNITS_PER_QUANTITY: Record<string, number> = {
  MOVIE_GENERATION: 100,
  ASSET_CALL: 50,
  RENDER_SECONDS: 1,
};

export type EngineCostEstimator = (kind: string, quantity: number) => number;

export function estimateEngineCostUnits(kind: string, quantity: number): number {
  const per = OPS_COST_UNITS_PER_QUANTITY[kind] ?? 1;
  return per * Math.max(0, quantity);
}
