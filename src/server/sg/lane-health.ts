/**
 * Gateway liveness for ENFORCED routing. Fail closed. Never throws.
 * LEGACY does not call this. A non-OK or unreachable /health is unhealthy.
 */

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
