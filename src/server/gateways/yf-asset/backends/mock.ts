import type { NormalizedAssetMeta } from "@/server/gateways/yf-asset/jobs";
import type {
  BackendStatusResult,
  BackendSubmitInput,
  BackendSubmitResult,
  VideoBackend,
} from "@/server/gateways/yf-asset/backends/types";

export class MockVideoBackend implements VideoBackend {
  readonly kind = "mock";
  readonly requests = new Map<string, { input: BackendSubmitInput; asset: NormalizedAssetMeta }>();
  private seq = 0;

  constructor(
    private readonly asset: NormalizedAssetMeta = {
      url: "https://example.test/generated/clip.mp4",
      mimeType: "video/mp4",
      durationMs: 1000,
      width: 2,
      height: 2,
    },
  ) {}

  async submit(input: BackendSubmitInput): Promise<BackendSubmitResult> {
    this.seq += 1;
    const backendRequestId = `mock_${this.seq}`;
    this.requests.set(backendRequestId, { input, asset: this.asset });
    return { backendRequestId };
  }

  async status(): Promise<BackendStatusResult> {
    return { status: "succeeded" };
  }

  async result(_model: string, backendRequestId: string): Promise<NormalizedAssetMeta> {
    const row = this.requests.get(backendRequestId);
    if (!row) {
      throw new Error("Unknown mock backend request.");
    }
    return row.asset;
  }
}
