import { describe, expect, it } from "vitest";
import { JobType } from "@/server/domain/status";
import {
  attachmentFilename,
  PublicationDestination,
  shareWatchPath,
} from "@/server/publication/schema";

describe("publication schema helpers", () => {
  it("uses YouFlicks destination strings, not vendor enums", () => {
    expect(PublicationDestination.DOWNLOAD).toBe("DOWNLOAD");
    expect(PublicationDestination.SHARE_LINK).toBe("SHARE_LINK");
    expect(JobType.PUBLISH).toBe("PUBLISH");
    expect("AI_PUBLISH" in JobType).toBe(false);
    expect("AI_SHARE" in JobType).toBe(false);
  });

  it("sanitizes export filenames and share paths", () => {
    expect(attachmentFilename("Family Film")).toBe("Family-Film.mp4");
    expect(shareWatchPath("abc.def")).toBe("/watch/abc.def");
  });
});
