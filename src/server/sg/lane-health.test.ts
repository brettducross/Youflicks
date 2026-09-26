import { describe, expect, it } from "vitest";
import { probeEligibleLaneHealth } from "@/server/sg/lane-health";

describe("eligible lane health probes", () => {
  it("probes lanes in parallel and reuses a cached promise", async () => {
    let calls = 0;
    const probe = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return true;
    };
    const cache = new Map<string, Promise<boolean>>();
    const started = Date.now();
    const first = await probeEligibleLaneHealth(
      [
        { laneId: "lane-a", baseUrl: "http://127.0.0.1:9" },
        { laneId: "lane-b", baseUrl: "http://127.0.0.1:10" },
        { laneId: "lane-c", baseUrl: null },
      ],
      probe,
      cache,
    );
    expect(Date.now() - started).toBeLessThan(80);
    expect(calls).toBe(2);
    expect(first.get("lane-a")).toBe(true);
    expect(first.get("lane-c")).toBe(false);
    await probeEligibleLaneHealth(
      [{ laneId: "lane-a", baseUrl: "http://127.0.0.1:9" }],
      probe,
      cache,
    );
    expect(calls).toBe(2);
  });
});
