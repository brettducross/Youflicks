/**
 * Gateway liveness for ENFORCED routing. Fail closed. Never throws.
 * LEGACY does not call this. A non-OK or unreachable /health is unhealthy.
 */

export type LaneHealthTarget = {
  laneId: string;
  /** Null when the resolver rejected the env name or the URL. Do not fetch. */
  baseUrl: string | null;
};

/**
 * Probe eligible lanes together. A shared cache returns the same promise for
 * the same lane and URL, so one job does not probe a lane once per role.
 * Each probe still has its own timeout. Parallel calls bound the wait to one
 * probe, not the sum.
 */
export async function probeEligibleLaneHealth(
  lanes: readonly LaneHealthTarget[],
  probe: (baseUrl: string) => Promise<boolean>,
  cache: Map<string, Promise<boolean>>,
): Promise<Map<string, boolean>> {
  const health = new Map<string, boolean>();
  await Promise.all(
    lanes.map(async (lane) => {
      if (!lane.baseUrl) {
        health.set(lane.laneId, false);
        return;
      }
      const key = `${lane.laneId}\n${lane.baseUrl}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = probe(lane.baseUrl);
        cache.set(key, pending);
      }
      health.set(lane.laneId, await pending);
    }),
  );
  return health;
}

export async function probeLaneHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1_500,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL("health", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    return false;
  }
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
