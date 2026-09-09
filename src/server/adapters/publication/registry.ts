import { AppError } from "@/lib/errors";
import type { PublicationPort } from "@/server/ports/publication";
import { DownloadPublicationAdapter } from "@/server/adapters/publication/download";
import { ShareLinkPublicationAdapter } from "@/server/adapters/publication/share-link";
import { PublicationDestination } from "@/server/publication/schema";

export class PublicationAdapterRegistry {
  private readonly adapters = new Map<string, PublicationPort>();

  constructor(adapters: PublicationPort[] = [new DownloadPublicationAdapter(), new ShareLinkPublicationAdapter()]) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: PublicationPort) {
    this.adapters.set(adapter.destinationKey, adapter);
  }

  has(destinationKey: string) {
    return this.adapters.has(destinationKey);
  }

  get(destinationKey: string): PublicationPort {
    const adapter = this.adapters.get(destinationKey);
    if (!adapter) {
      throw AppError.publicationDestinationUnavailable(
        "That share or export destination is not available.",
        { destinationKey },
      );
    }
    return adapter;
  }

  keys() {
    return [...this.adapters.keys()];
  }

  v1Available() {
    return {
      [PublicationDestination.DOWNLOAD]: this.has(PublicationDestination.DOWNLOAD),
      [PublicationDestination.SHARE_LINK]: this.has(PublicationDestination.SHARE_LINK),
    };
  }
}
