import { describe, expect, it } from "vitest";
import { AppError, isAppError, toErrorResponse } from "@/lib/errors";

describe("isAppError", () => {
  it("recognizes AppError instances", () => {
    expect(isAppError(AppError.validation("Nope."))).toBe(true);
  });

  it("recognizes duck-typed AppError objects from another module copy", () => {
    const foreign = Object.assign(new Error("Nope."), {
      name: "AppError",
      code: "VALIDATION",
      status: 400,
    });
    expect(isAppError(foreign)).toBe(true);
    expect(toErrorResponse(foreign).status).toBe(400);
    expect(toErrorResponse(foreign).body.error.code).toBe("VALIDATION");
  });

  it("does not treat ordinary errors as AppError", () => {
    expect(isAppError(new Error("boom"))).toBe(false);
    expect(toErrorResponse(new Error("boom")).status).toBe(500);
  });

  it("maps emailUnverified to EMAIL_UNVERIFIED 403", () => {
    const error = AppError.emailUnverified();
    expect(isAppError(error)).toBe(true);
    expect(toErrorResponse(error).status).toBe(403);
    expect(toErrorResponse(error).body.error.code).toBe("EMAIL_UNVERIFIED");
  });

  it("maps M8.2 entitlement denies to typed HTTP codes", () => {
    expect(toErrorResponse(AppError.rateLimited()).status).toBe(429);
    expect(toErrorResponse(AppError.rateLimited()).body.error.code).toBe("RATE_LIMITED");
    expect(toErrorResponse(AppError.durationExceedsPlan()).status).toBe(403);
    expect(toErrorResponse(AppError.durationExceedsPlan()).body.error.code).toBe(
      "DURATION_EXCEEDS_PLAN",
    );
    expect(toErrorResponse(AppError.suspended()).status).toBe(403);
    expect(toErrorResponse(AppError.suspended()).body.error.code).toBe("SUSPENDED");
  });
});
