import { describe, expect, it, vi } from "vitest";
import { HttpQueueVideoBackend } from "@/server/gateways/yf-asset/backends/http-queue";
import { parseYfAssetGatewayConfig } from "@/server/gateways/yf-asset/config";

describe("HttpQueueVideoBackend", () => {
  it("submits to fal-shaped queue URLs and normalizes a video URL", async () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "fal-secret",
      YF_GATEWAY_BACKEND: "fal",
      YF_GATEWAY_MODEL: "fal-ai/ltx-video",
      YF_GATEWAY_WEBHOOK_URL: "https://gateway.test/v1/webhooks/backend",
    });
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const href = String(url);
      if (init?.method === "POST") {
        expect(href).toContain("https://queue.fal.run/fal-ai/ltx-video");
        expect(href).toContain("fal_webhook=");
        expect(new Headers(init.headers).get("authorization")).toBe("Key fal-secret");
        const body = JSON.parse(String(init.body));
        expect(body.prompt).toContain("porch");
        expect(body).not.toHaveProperty("creativePlan");
        return new Response(JSON.stringify({ request_id: "req_1" }), { status: 200 });
      }
      if (href.endsWith("/status")) {
        return new Response(JSON.stringify({ status: "COMPLETED", request_id: "req_1" }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ video: { url: "https://cdn.example/clip.mp4", content_type: "video/mp4" } }),
        { status: 200 },
      );
    });
    const backend = new HttpQueueVideoBackend(config, fetchImpl);
    const submitted = await backend.submit({
      model: "fal-ai/ltx-video",
      prompt: "Gold light on the porch.",
      extra: {},
      webhookUrl: config.webhookUrl,
    });
    expect(submitted.backendRequestId).toBe("req_1");
    await expect(backend.status("fal-ai/ltx-video", "req_1")).resolves.toMatchObject({
      status: "succeeded",
    });
    await expect(backend.result("fal-ai/ltx-video", "req_1")).resolves.toMatchObject({
      url: "https://cdn.example/clip.mp4",
      mimeType: "video/mp4",
    });
  });

  it("uses open-string model + host from config so another queue needs no code change", async () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "other-secret",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_BACKEND_BASE_URL: "https://queue.other.test",
      YF_GATEWAY_BACKEND_AUTH_SCHEME: "Bearer",
      YF_GATEWAY_MODEL: "other/open-string-model",
    });
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://queue.other.test/other/open-string-model");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer other-secret");
      return new Response(JSON.stringify({ request_id: "other_1" }), { status: 200 });
    });
    const backend = new HttpQueueVideoBackend(config, fetchImpl);
    const submitted = await backend.submit({
      model: "other/open-string-model",
      prompt: "clip",
      extra: {},
    });
    expect(submitted.backendRequestId).toBe("other_1");
  });
});
