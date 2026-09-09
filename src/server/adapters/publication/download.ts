import type { PublicationPort, PublicationResult, PublishInput } from "@/server/ports/publication";
import { PublicationDestination } from "@/server/publication/schema";

/**
 * Local DOWNLOAD adapter. The app streams the owner attachment;
 * this port records a successful local export (no remote upload).
 */
export class DownloadPublicationAdapter implements PublicationPort {
  readonly destinationKey = PublicationDestination.DOWNLOAD;

  async publish(input: PublishInput): Promise<PublicationResult> {
    return {
      status: "PUBLISHED",
      payload: {
        adapterMeta: {
          contentDisposition: input.options?.contentDisposition ?? "attachment",
        },
      },
    };
  }
}
