import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IN_MOVIE_SURFACE } from "@/server/advertising/types";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { validateCreativePlan } from "@/server/director/validate";
import { JobType } from "@/server/domain/status";
import { parseYfAssetGatewayConfig } from "@/server/gateways/yf-asset/config";

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkFiles(full, acc);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("R1 gateway vs domain boundary", () => {
  it("keeps Replicate HTTP out of domain AssetGeneratorPort / Prisma / creative services", () => {
    const roots = [
      path.join(process.cwd(), "src/server/ports"),
      path.join(process.cwd(), "src/server/assets"),
      path.join(process.cwd(), "src/server/services/asset.ts"),
      path.join(process.cwd(), "src/server/services/asset-contract.ts"),
      path.join(process.cwd(), "src/server/services/asset-worker.ts"),
      path.join(process.cwd(), "src/server/adapters/assets/http-asset.ts"),
      path.join(process.cwd(), "src/server/director"),
      path.join(process.cwd(), "src/server/story"),
      path.join(process.cwd(), "src/server/timeline"),
      path.join(process.cwd(), "src/server/services/director.ts"),
      path.join(process.cwd(), "src/server/services/story.ts"),
      path.join(process.cwd(), "src/server/services/timeline.ts"),
      path.join(process.cwd(), "src/server/services/render.ts"),
      path.join(process.cwd(), "src/server/services/movie.ts"),
      path.join(process.cwd(), "src/server/services/playback.ts"),
      path.join(process.cwd(), "prisma/schema.prisma"),
    ];
    const files = roots.flatMap((root) =>
      statSync(root).isDirectory() ? walkFiles(root) : [root],
    );
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/api\.replicate\.com/);
      expect(src, file).not.toMatch(/REPLICATE_API_TOKEN/);
      expect(src, file).not.toMatch(/wan-video\/wan-2\.7-i2v/);
      expect(src, file).not.toMatch(/from ["']replicate["']/);
    }
  });

  it("records providerKey as an open string on the gateway, including replicate:model", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      REPLICATE_API_TOKEN: "r8_token",
      YF_GATEWAY_BACKEND: "replicate",
      YF_GATEWAY_PROVIDER_KEY: "replicate:wan-video/wan-2.7-i2v",
    });
    expect(config.providerKey).toBe("replicate:wan-video/wan-2.7-i2v");
    expect(config.providerKey).not.toMatch(/^(fal|kling|runway)$/i);
  });

  it("does not let commercial fields into CreativePlan and leaves IN_MOVIE out of JobType", () => {
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Porch light",
        planKey: "FAMILY",
        credits: 4,
      }),
    ).toThrow(/commercial entitlement/i);
    expect("AI_ADS" in JobType).toBe(false);
    expect("IN_MOVIE" in JobType).toBe(false);
    expect(IN_MOVIE_SURFACE).toBe("IN_MOVIE");
  });
});
