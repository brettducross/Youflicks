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
});
