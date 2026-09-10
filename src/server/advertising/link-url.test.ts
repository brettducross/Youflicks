import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { allowlistedHttpsLinkUrl, persistableSponsorLinkUrl } from "@/server/advertising/link-url";

describe("allowlistedHttpsLinkUrl (YF-C01)", () => {
  it("accepts a valid https destination and normalizes it", () => {
    expect(allowlistedHttpsLinkUrl("https://harbor.example")).toBe("https://harbor.example/");
    expect(allowlistedHttpsLinkUrl("  HTTPS://harbor.example/path  ")).toBe(
      "https://harbor.example/path",
    );
  });

  it("rejects http, javascript, data, relative, protocol-relative, empty, and malformed", () => {
    expect(allowlistedHttpsLinkUrl("http://harbor.example")).toBeNull();
    expect(allowlistedHttpsLinkUrl("javascript:alert(1)")).toBeNull();
    expect(allowlistedHttpsLinkUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(allowlistedHttpsLinkUrl("/relative/path")).toBeNull();
    expect(allowlistedHttpsLinkUrl("//evil.example/phish")).toBeNull();
    expect(allowlistedHttpsLinkUrl("")).toBeNull();
    expect(allowlistedHttpsLinkUrl("   ")).toBeNull();
    expect(allowlistedHttpsLinkUrl("not a url")).toBeNull();
    expect(allowlistedHttpsLinkUrl("https://")).toBeNull();
    expect(allowlistedHttpsLinkUrl("https://user:pass@harbor.example")).toBeNull();
    expect(allowlistedHttpsLinkUrl(null)).toBeNull();
    expect(allowlistedHttpsLinkUrl(undefined)).toBeNull();
  });
});

describe("persistableSponsorLinkUrl (YF-C01 ingest)", () => {
  it("accepts valid https and treats omitted destinations as not clickable", () => {
    expect(persistableSponsorLinkUrl("https://harbor.example/offer")).toBe(
      "https://harbor.example/offer",
    );
    expect(persistableSponsorLinkUrl(null)).toBeNull();
    expect(persistableSponsorLinkUrl(undefined)).toBeNull();
  });

  it("rejects http, javascript, data, empty, and malformed on ingest", () => {
    const rejected = [
      "http://harbor.example",
      "javascript:alert(1)",
      "data:text/html,hi",
      "",
      "   ",
      "//evil.example",
      "https://",
    ];
    for (const value of rejected) {
      expect(() => persistableSponsorLinkUrl(value)).toThrow(AppError);
      try {
        persistableSponsorLinkUrl(value);
      } catch (error) {
        expect(error).toMatchObject({ code: "VALIDATION" });
      }
    }
  });
});
