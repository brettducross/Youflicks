import type { PublicationPort, PublicationResult, PublishInput } from "@/server/ports/publication";
import { PublicationDestination } from "@/server/publication/schema";

/**
 * Local SHARE_LINK adapter. Token issuance lives on PublicationService;
 * this port confirms the destination is available (no remote upload).
 */
export class ShareLinkPublicationAdapter implements PublicationPort {
  readonly destinationKey = PublicationDestination.SHARE_LINK;

  async publish(input: PublishInput): Promise<PublicationResult> {
    return {
      status: "PUBLISHED",
      payload: {
        adapterMeta: {
          watchOnly: true,
        },
        expiresAt: input.options?.expiresAt,
      },
    };
  }
}
