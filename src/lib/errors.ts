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
