import { readFileSync } from "node:fs";
import path from "node:path";

const FIXTURE_DIR = path.join(process.cwd(), "src/server/gateways/yf-asset/fixtures/replicate");

export const RECORDED_WAN_VIDEO_BYTES = Buffer.from("youflicks-recorded-wan-i2v-mp4");
export const RECORDED_PREDICTION_ID = "pred_recorded_wan_i2v";
export const RECORDED_FILE_GET_URL =
  "https://api.replicate.com/v1/files/file-recorded-wan-i2v/contents";
export const RECORDED_OUTPUT_URL = "https://replicate.delivery/recorded/wan-i2v-output.mp4";

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as unknown;
}

export const RECORDED_FILE_CREATE = loadJson("file-create.json");
export const RECORDED_PREDICTION_CREATED = loadJson("prediction-created.json");
export const RECORDED_PREDICTION_SUCCEEDED = loadJson("prediction-succeeded.json");

const PUBLIC_FILE_HOSTS =
  /catbox\.moe|0x0\.st|litterbox|transfer\.sh|file\.io|tmpfiles\.org|imgur\.com/i;

/**
 * Recorded Replicate HTTP. CI uses this instead of live spend.
 * Asserts authenticated files.create and refuses public file hosts.
 */
export function createRecordedReplicateFetch(options?: {
  token?: string;
  model?: string;
}): typeof fetch {
  const token = options?.token ?? "r8_recorded_token";
  const model = options?.model ?? "wan-video/wan-2.7-i2v";
  return (async (input, init) => {
    const url = String(input);
    if (PUBLIC_FILE_HOSTS.test(url) || PUBLIC_FILE_HOSTS.test(String(init?.body ?? ""))) {
      throw new Error("Recorded Replicate fetch refused a public file host.");
    }
    const method = (init?.method ?? "GET").toUpperCase();
    const auth = new Headers(init?.headers).get("authorization");
    if (url.startsWith("https://api.replicate.com/") && auth !== `Bearer ${token}`) {
      return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 });
    }

    if (method === "POST" && url === "https://api.replicate.com/v1/files") {
      if (!(init?.body instanceof FormData)) {
        throw new Error("files.create must upload a Buffer via multipart FormData.");
      }
      const content = init.body.get("content");
      if (!content) {
        throw new Error("files.create FormData is missing content.");
      }
      return json(RECORDED_FILE_CREATE);
    }

    if (method === "POST" && url === `https://api.replicate.com/v1/models/${model}/predictions`) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const inner = isRecord(body.input) ? body.input : {};
      if (inner.first_frame !== RECORDED_FILE_GET_URL) {
        throw new Error("I2V first_frame must be the authenticated files.create URL.");
      }
      if (typeof inner.prompt !== "string" || inner.prompt.length === 0) {
        throw new Error("Prediction input is missing prompt.");
      }
      for (const value of Object.values(inner)) {
        if (typeof value === "string" && PUBLIC_FILE_HOSTS.test(value)) {
          throw new Error("Prediction input must not use a public file host.");
        }
      }
      return json(RECORDED_PREDICTION_CREATED);
    }

    if (method === "GET" && url === `https://api.replicate.com/v1/predictions/${RECORDED_PREDICTION_ID}`) {
      return json(RECORDED_PREDICTION_SUCCEEDED);
    }

    if (method === "GET" && url === RECORDED_OUTPUT_URL) {
      return new Response(RECORDED_WAN_VIDEO_BYTES, {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });
    }

    throw new Error(`Unexpected recorded Replicate request: ${method} ${url}`);
  }) as typeof fetch;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
