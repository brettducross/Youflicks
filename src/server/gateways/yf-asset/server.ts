import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { HttpQueueVideoBackend } from "@/server/gateways/yf-asset/backends/http-queue";
import { MockVideoBackend } from "@/server/gateways/yf-asset/backends/mock";
import { ReplicateVideoBackend } from "@/server/gateways/yf-asset/backends/replicate";
import type { VideoBackend } from "@/server/gateways/yf-asset/backends/types";
import {
  assertGatewaySecrets,
  gatewayReady,
  parseYfAssetGatewayConfig,
  type YfAssetGatewayConfig,
} from "@/server/gateways/yf-asset/config";
import { YfAssetGenerateService } from "@/server/gateways/yf-asset/generate";
import { GatewayJobStore } from "@/server/gateways/yf-asset/jobs";
import { SpendGuard } from "@/server/gateways/yf-asset/spend";
import { logger } from "@/lib/logger";

export type YfAssetGatewayRuntime = {
  config: YfAssetGatewayConfig;
  jobs: GatewayJobStore;
  spend: SpendGuard;
  generate: YfAssetGenerateService;
};

export function createYfAssetGatewayRuntime(
  config: YfAssetGatewayConfig = parseYfAssetGatewayConfig(),
  backend: VideoBackend = createBackend(config),
): YfAssetGatewayRuntime {
  const jobs = new GatewayJobStore();
  const spend = new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob);
  const generate = new YfAssetGenerateService(config, backend, jobs, spend);
  return { config, jobs, spend, generate };
}

export function createBackend(config: YfAssetGatewayConfig): VideoBackend {
  if (config.backend === "mock") {
    return new MockVideoBackend();
  }
  if (config.backend === "replicate") {
    return new ReplicateVideoBackend(config);
  }
  return new HttpQueueVideoBackend(config);
}

export function startYfAssetGateway(
  runtime: YfAssetGatewayRuntime = createYfAssetGatewayRuntime(),
) {
  const server = createServer((req, res) => {
    void handleRequest(runtime, req, res);
  });
  server.listen(runtime.config.listenPort, runtime.config.listenHost, () => {
    logger.info("yf_asset_gateway.listen", {
      host: runtime.config.listenHost,
      port: runtime.config.listenPort,
      providerKey: runtime.config.providerKey,
      backend: runtime.config.backend,
      capabilities: runtime.config.capabilities,
      ready: gatewayReady(runtime.config),
    });
  });
  return server;
}

async function handleRequest(
  runtime: YfAssetGatewayRuntime,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: gatewayReady(runtime.config),
        service: "youflicks-asset-gateway",
        providerKey: runtime.config.providerKey,
        backend: runtime.config.backend,
        capabilities: runtime.config.capabilities,
        spend: runtime.spend.snapshot(),
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/capabilities") {
      return json(res, 200, {
        providerKey: runtime.config.providerKey,
        capabilities: runtime.config.capabilities,
        model: runtime.config.model || null,
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/webhooks/backend") {
      if (!authorizeWebhook(runtime.config, req)) {
        return json(res, 401, { error: "Unauthorized webhook.", code: "UNAUTHORIZED" });
      }
      const body = await readJson(req);
      const result = runtime.generate.acceptWebhook(body);
      return json(res, result.status, result.body);
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/jobs/")) {
      if (!authorizeBearer(runtime.config, req)) {
        return json(res, 401, { error: "Unauthorized.", code: "UNAUTHORIZED" });
      }
      const jobId = url.pathname.slice("/v1/jobs/".length);
      const job = runtime.jobs.get(jobId);
      if (!job) {
        return json(res, 404, { error: "Unknown YouFlicks gateway job.", code: "NOT_FOUND" });
      }
      return json(res, 200, job);
    }

    if (req.method === "POST" && url.pathname === "/v1/generate") {
      if (!authorizeBearer(runtime.config, req)) {
        return json(res, 401, { error: "Unauthorized.", code: "UNAUTHORIZED" });
      }
      const body = await readJson(req);
      const result = await runtime.generate.generate(body);
      return json(res, result.status, result.body);
    }

    return json(res, 404, { error: "Not found.", code: "NOT_FOUND" });
  } catch (error) {
    logger.error("yf_asset_gateway.request_failed", {
      path: url.pathname,
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(res, 500, { error: "Asset gateway failed.", code: "ASSET_PROVIDER_UNAVAILABLE" });
  }
}

function authorizeBearer(config: YfAssetGatewayConfig, req: IncomingMessage): boolean {
  try {
    assertGatewaySecrets(config);
  } catch {
    return false;
  }
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${config.apiKey}`;
}

function authorizeWebhook(config: YfAssetGatewayConfig, req: IncomingMessage): boolean {
  if (!config.webhookSecret) {
    return true;
  }
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${config.webhookSecret}`;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startYfAssetGateway();
}
