export const ErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  FORBIDDEN: "FORBIDDEN",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
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
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
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
