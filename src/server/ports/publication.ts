/**
 * Destination adapter boundary for M7 Publication.
 *
 * DOWNLOAD may be a local no-op (the app streams the attachment).
 * SHARE_LINK may be a local no-op (the service issues the token).
 * Future remotes (youtube, …) implement the same contract.
 * Attribution, if any, lives outside this port.
 * This port does not own authz, READY checks, or PlaybackPort.
 */
export type PublishInput = {
  publicationId: string;
  movieId: string;
  destinationKey: string;
  storageKey: string;
  mimeType?: string;
  title?: string;
  options?: {
    expiresAt?: string;
    contentDisposition?: string;
  };
};

export type PublicationResult = {
  status: "PUBLISHED" | "FAILED" | "PENDING";
  externalId?: string;
  payload?: Record<string, unknown>;
  error?: string;
};

export interface PublicationPort {
  readonly destinationKey: string;
  publish(input: PublishInput): Promise<PublicationResult>;
}
