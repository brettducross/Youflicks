export const ErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  FORBIDDEN: "FORBIDDEN",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  UNSUPPORTED_MEDIA: "UNSUPPORTED_MEDIA",
  ANALYSIS_FAILED: "ANALYSIS_FAILED",
  INVALID_ANALYSIS: "INVALID_ANALYSIS",
  JOB_FAILED: "JOB_FAILED",
  DIRECTOR_INPUT_INVALID: "DIRECTOR_INPUT_INVALID",
  DIRECTOR_CAPABILITY_UNAVAILABLE: "DIRECTOR_CAPABILITY_UNAVAILABLE",
  DIRECTOR_PLAN_INVALID: "DIRECTOR_PLAN_INVALID",
  DIRECTOR_PROVIDER_UNAVAILABLE: "DIRECTOR_PROVIDER_UNAVAILABLE",
  DIRECTOR_CONSTRAINT_CONFLICT: "DIRECTOR_CONSTRAINT_CONFLICT",
  STORY_INPUT_INVALID: "STORY_INPUT_INVALID",
  STORY_DOCUMENT_INVALID: "STORY_DOCUMENT_INVALID",
  STORY_PROVIDER_UNAVAILABLE: "STORY_PROVIDER_UNAVAILABLE",
  STORY_PLAN_REQUIRED: "STORY_PLAN_REQUIRED",
  STORY_CAPABILITY_UNAVAILABLE: "STORY_CAPABILITY_UNAVAILABLE",
  TIMELINE_INPUT_INVALID: "TIMELINE_INPUT_INVALID",
  TIMELINE_DOCUMENT_INVALID: "TIMELINE_DOCUMENT_INVALID",
  TIMELINE_PROVIDER_UNAVAILABLE: "TIMELINE_PROVIDER_UNAVAILABLE",
  TIMELINE_STORY_REQUIRED: "TIMELINE_STORY_REQUIRED",
  TIMELINE_CAPABILITY_UNAVAILABLE: "TIMELINE_CAPABILITY_UNAVAILABLE",
  ASSET_INPUT_INVALID: "ASSET_INPUT_INVALID",
  ASSET_DOCUMENT_INVALID: "ASSET_DOCUMENT_INVALID",
  ASSET_PROVIDER_UNAVAILABLE: "ASSET_PROVIDER_UNAVAILABLE",
  ASSET_TIMELINE_REQUIRED: "ASSET_TIMELINE_REQUIRED",
  ASSET_CAPABILITY_UNAVAILABLE: "ASSET_CAPABILITY_UNAVAILABLE",
  RENDER_INPUT_INVALID: "RENDER_INPUT_INVALID",
  RENDER_RESULT_INVALID: "RENDER_RESULT_INVALID",
  RENDER_PROVIDER_UNAVAILABLE: "RENDER_PROVIDER_UNAVAILABLE",
  RENDER_TIMELINE_REQUIRED: "RENDER_TIMELINE_REQUIRED",
  RENDER_CAPABILITY_UNAVAILABLE: "RENDER_CAPABILITY_UNAVAILABLE",
  RENDER_SOURCE_UNRESOLVED: "RENDER_SOURCE_UNRESOLVED",
  PLAYBACK_INPUT_INVALID: "PLAYBACK_INPUT_INVALID",
  PLAYBACK_RENDER_REQUIRED: "PLAYBACK_RENDER_REQUIRED",
  PLAYBACK_SOURCE_MISSING: "PLAYBACK_SOURCE_MISSING",
  PLAYBACK_OUTPUT_INVALID: "PLAYBACK_OUTPUT_INVALID",
  PLAYBACK_ADAPTER_UNAVAILABLE: "PLAYBACK_ADAPTER_UNAVAILABLE",
  PLAYBACK_SESSION_INVALID: "PLAYBACK_SESSION_INVALID",
  MOVIE_INPUT_INVALID: "MOVIE_INPUT_INVALID",
  MOVIE_RENDER_REQUIRED: "MOVIE_RENDER_REQUIRED",
  MOVIE_SOURCE_MISSING: "MOVIE_SOURCE_MISSING",
  MOVIE_OUTPUT_INVALID: "MOVIE_OUTPUT_INVALID",
  MOVIE_STORAGE_UNAVAILABLE: "MOVIE_STORAGE_UNAVAILABLE",
  MOVIE_NOT_READY: "MOVIE_NOT_READY",
  PUBLICATION_INPUT_INVALID: "PUBLICATION_INPUT_INVALID",
  PUBLICATION_MOVIE_REQUIRED: "PUBLICATION_MOVIE_REQUIRED",
  PUBLICATION_SOURCE_MISSING: "PUBLICATION_SOURCE_MISSING",
  PUBLICATION_DESTINATION_UNAVAILABLE: "PUBLICATION_DESTINATION_UNAVAILABLE",
  PUBLICATION_TOKEN_INVALID: "PUBLICATION_TOKEN_INVALID",
  PUBLICATION_REVOKED: "PUBLICATION_REVOKED",
  EMAIL_UNVERIFIED: "EMAIL_UNVERIFIED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static unauthorized(message = "You need to sign in to continue.") {
    return new AppError(ErrorCodes.UNAUTHORIZED, message, 401);
  }

  static forbidden(message = "You cannot access this resource.") {
    return new AppError(ErrorCodes.FORBIDDEN, message, 403);
  }

  static notFound(message = "The requested resource was not found.") {
    return new AppError(ErrorCodes.NOT_FOUND, message, 404);
  }

  static validation(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.VALIDATION, message, 400, details);
  }

  static conflict(message: string) {
    return new AppError(ErrorCodes.CONFLICT, message, 409);
  }

  static providerNotConfigured(port: string) {
    return new AppError(
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      `${port} has no adapter configured yet.`,
      501,
      { port },
    );
  }

  static providerUnavailable(message = "No analysis provider is available for that capability.") {
    return new AppError(ErrorCodes.PROVIDER_UNAVAILABLE, message, 503);
  }

  static unsupportedMedia(message = "That media type cannot be analyzed yet.") {
    return new AppError(ErrorCodes.UNSUPPORTED_MEDIA, message, 422);
  }

  static analysisFailed(message = "Media analysis failed.") {
    return new AppError(ErrorCodes.ANALYSIS_FAILED, message, 502);
  }

  static invalidAnalysis(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.INVALID_ANALYSIS, message, 422, details);
  }

  static jobFailed(message = "The background job failed.") {
    return new AppError(ErrorCodes.JOB_FAILED, message, 500);
  }

  static directorInputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.DIRECTOR_INPUT_INVALID, message, 422, details);
  }

  static directorCapabilityUnavailable(capability: string) {
    return new AppError(
      ErrorCodes.DIRECTOR_CAPABILITY_UNAVAILABLE,
      `No ready adapter can perform ${capability}.`,
      503,
      { capability },
    );
  }

  static directorPlanInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.DIRECTOR_PLAN_INVALID, message, 422, details);
  }

  static directorProviderUnavailable(message = "A required capability adapter is unavailable.") {
    return new AppError(ErrorCodes.DIRECTOR_PROVIDER_UNAVAILABLE, message, 503);
  }

  static directorConstraintConflict(message: string) {
    return new AppError(ErrorCodes.DIRECTOR_CONSTRAINT_CONFLICT, message, 409);
  }

  static storyInputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.STORY_INPUT_INVALID, message, 422, details);
  }

  static storyDocumentInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.STORY_DOCUMENT_INVALID, message, 422, details);
  }

  static storyProviderUnavailable(message = "A required story composer adapter is unavailable.") {
    return new AppError(ErrorCodes.STORY_PROVIDER_UNAVAILABLE, message, 503);
  }

  static storyPlanRequired(message = "A READY CreativePlan is required before story composition.") {
    return new AppError(ErrorCodes.STORY_PLAN_REQUIRED, message, 422);
  }

  static storyCapabilityUnavailable(message = "Story composition is not available.") {
    return new AppError(ErrorCodes.STORY_CAPABILITY_UNAVAILABLE, message, 503);
  }

  static timelineInputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.TIMELINE_INPUT_INVALID, message, 422, details);
  }

  static timelineDocumentInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.TIMELINE_DOCUMENT_INVALID, message, 422, details);
  }

  static timelineProviderUnavailable(
    message = "A required timeline composer adapter is unavailable.",
  ) {
    return new AppError(ErrorCodes.TIMELINE_PROVIDER_UNAVAILABLE, message, 503);
  }

  static timelineStoryRequired(
    message = "A READY story is required before building a cut.",
  ) {
    return new AppError(ErrorCodes.TIMELINE_STORY_REQUIRED, message, 422);
  }

  static timelineCapabilityUnavailable(message = "Cut composition is not available.") {
    return new AppError(ErrorCodes.TIMELINE_CAPABILITY_UNAVAILABLE, message, 503);
  }

  static assetInputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.ASSET_INPUT_INVALID, message, 422, details);
  }

  static assetDocumentInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.ASSET_DOCUMENT_INVALID, message, 422, details);
  }

  static assetProviderUnavailable(message = "A required asset generator adapter is unavailable.") {
    return new AppError(ErrorCodes.ASSET_PROVIDER_UNAVAILABLE, message, 503);
  }

  static assetTimelineRequired(
    message = "A READY cut is required before making missing pieces.",
  ) {
    return new AppError(ErrorCodes.ASSET_TIMELINE_REQUIRED, message, 422);
  }

  static assetCapabilityUnavailable(capability: string) {
    return new AppError(
      ErrorCodes.ASSET_CAPABILITY_UNAVAILABLE,
      `No ready adapter can perform ${capability}.`,
      503,
      { capability },
    );
  }

  static renderInputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.RENDER_INPUT_INVALID, message, 422, details);
  }

  static renderResultInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.RENDER_RESULT_INVALID, message, 422, details);
  }

  static renderProviderUnavailable(message = "A required renderer adapter is unavailable.") {
    return new AppError(ErrorCodes.RENDER_PROVIDER_UNAVAILABLE, message, 503);
  }

  static renderTimelineRequired(
    message = "A READY cut is required before rendering.",
  ) {
    return new AppError(ErrorCodes.RENDER_TIMELINE_REQUIRED, message, 422);
  }

  static renderCapabilityUnavailable(message = "Rendering is not available.") {
    return new AppError(ErrorCodes.RENDER_CAPABILITY_UNAVAILABLE, message, 503);
  }

  static renderSourceUnresolved(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.RENDER_SOURCE_UNRESOLVED, message, 422, details);
  }

  static playbackInputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.PLAYBACK_INPUT_INVALID, message, 422, details);
  }

  static playbackRenderRequired(
    message = "A successful render is required before you can watch.",
  ) {
    return new AppError(ErrorCodes.PLAYBACK_RENDER_REQUIRED, message, 422);
  }

  static playbackSourceMissing(message = "The render file is missing from storage.") {
    return new AppError(ErrorCodes.PLAYBACK_SOURCE_MISSING, message, 404);
  }

  static playbackOutputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.PLAYBACK_OUTPUT_INVALID, message, 422, details);
  }

  static playbackAdapterUnavailable(message = "Watching is not available on this surface.") {
    return new AppError(ErrorCodes.PLAYBACK_ADAPTER_UNAVAILABLE, message, 503);
  }

  static playbackSessionInvalid(message = "That watch session is not valid.") {
    return new AppError(ErrorCodes.PLAYBACK_SESSION_INVALID, message, 403);
  }

  static movieInputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.MOVIE_INPUT_INVALID, message, 422, details);
  }

  static movieRenderRequired(
    message = "A successful render is required before you can keep this film.",
  ) {
    return new AppError(ErrorCodes.MOVIE_RENDER_REQUIRED, message, 422);
  }

  static movieSourceMissing(message = "The render file is missing from storage.") {
    return new AppError(ErrorCodes.MOVIE_SOURCE_MISSING, message, 404);
  }

  static movieOutputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.MOVIE_OUTPUT_INVALID, message, 422, details);
  }

  static movieStorageUnavailable(message = "Library storage is not writable.") {
    return new AppError(ErrorCodes.MOVIE_STORAGE_UNAVAILABLE, message, 503);
  }

  static movieNotReady(message = "That film is not ready to watch.") {
    return new AppError(ErrorCodes.MOVIE_NOT_READY, message, 422);
  }

  static publicationInputInvalid(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCodes.PUBLICATION_INPUT_INVALID, message, 422, details);
  }

  static publicationMovieRequired(
    message = "Only a kept film that is ready can be shared or exported.",
  ) {
    return new AppError(ErrorCodes.PUBLICATION_MOVIE_REQUIRED, message, 422);
  }

  static publicationSourceMissing(message = "The library file is missing from storage.") {
    return new AppError(ErrorCodes.PUBLICATION_SOURCE_MISSING, message, 404);
  }

  static publicationDestinationUnavailable(
    message = "That share or export destination is not available.",
    details?: Record<string, unknown>,
  ) {
    return new AppError(ErrorCodes.PUBLICATION_DESTINATION_UNAVAILABLE, message, 503, details);
  }

  static publicationTokenInvalid(message = "That share link is not valid.") {
    return new AppError(ErrorCodes.PUBLICATION_TOKEN_INVALID, message, 403);
  }

  static publicationRevoked(message = "That share link has been revoked.") {
    return new AppError(ErrorCodes.PUBLICATION_REVOKED, message, 403);
  }

  static emailUnverified(message = "Verify your email before starting a movie.") {
    return new AppError(ErrorCodes.EMAIL_UNVERIFIED, message, 403);
  }
}

export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) {
    return true;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AppError" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

export function toErrorResponse(error: unknown): {
  status: number;
  body: { error: { code: string; message: string; details?: Record<string, unknown> } };
} {
  if (isAppError(error)) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: ErrorCodes.INTERNAL,
        message: "Something went wrong.",
      },
    },
  };
}
