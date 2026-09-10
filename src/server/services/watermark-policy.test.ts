import { describe, expect, it } from "vitest";
import { WatermarkPolicyService } from "@/server/services/watermark-policy";
import {
  WATERMARK_LABEL,
  WatermarkApplyReason,
  WatermarkSurface,
} from "@/server/watermark/types";

describe("WatermarkPolicyService M8.4", () => {
  const policy = new WatermarkPolicyService();

  it("requires watermark on free-tier flags and applies player chrome", () => {
    const decision = policy.decide({ watermarkRequired: true });
    expect(decision.required).toBe(true);
    expect(decision.label).toBe(WATERMARK_LABEL);
    expect(decision.applyTo).toContain(WatermarkSurface.PLAYER_CHROME);
    expect(decision.applyTo).toContain(WatermarkSurface.RENDER_PRESENTATION);
    expect(policy.chrome(decision)).toEqual({
      required: true,
      label: WATERMARK_LABEL,
      placement: WatermarkSurface.PLAYER_CHROME,
    });
  });

  it("does not require watermark when the entitlement flag is off", () => {
    const decision = policy.decide({ watermarkRequired: false });
    expect(decision.required).toBe(false);
    expect(decision.applyTo).toEqual([]);
    const bytes = new Uint8Array(Buffer.from("plain", "utf8"));
    const applied = policy.applyToOutput(bytes, decision);
    expect(applied.applied).toBe(false);
    expect(applied.mutated).toBe(false);
    expect(applied.reason).toBe(WatermarkApplyReason.NOT_REQUIRED);
  });

  it("stamps local deterministic render bytes when required", () => {
    const source = Buffer.from(
      "YouFlicks local deterministic render\nprofile=WEB_1080\ndurationMs=3000\n",
      "utf8",
    );
    const applied = policy.applyToOutput(new Uint8Array(source), policy.decide({ watermarkRequired: true }));
    expect(applied.required).toBe(true);
    expect(applied.applied).toBe(true);
    expect(applied.mutated).toBe(true);
    expect(applied.surface).toBe("OUTPUT_BYTES");
    expect(applied.reason).toBe(WatermarkApplyReason.LOCAL_TEXT_STAMPED);
    expect(Buffer.from(applied.bytes).toString("utf8")).toContain("watermark=YouFlicks");
  });

  it("does not mutate HTTP/binary movie essence — chrome only until §H4", () => {
    const bytes = new Uint8Array([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70]);
    const applied = policy.applyToOutput(bytes, policy.decide({ watermarkRequired: true }));
    expect(applied.applied).toBe(true);
    expect(applied.mutated).toBe(false);
    expect(applied.surface).toBe("CHROME_ONLY");
    expect(applied.reason).toBe(WatermarkApplyReason.BINARY_ESSENCE_CHROME_ONLY);
    expect(applied.bytes).toEqual(bytes);
  });

  it("does not re-stamp an already marked local fixture", () => {
    const source = Buffer.from(
      "YouFlicks local deterministic render\nwatermark=YouFlicks\n",
      "utf8",
    );
    const applied = policy.applyToOutput(
      new Uint8Array(source),
      policy.decide({ watermarkRequired: true }),
    );
    expect(applied.mutated).toBe(false);
    expect(applied.surface).toBe("OUTPUT_BYTES");
    expect(applied.reason).toBe(WatermarkApplyReason.ALREADY_STAMPED);
  });
});
