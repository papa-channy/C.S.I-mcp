import { describe, expect, it } from "vitest";
import { ServiceError, withNotFound } from "../../src/service/errors.js";

describe("ServiceError", () => {
  it("carries code, message, and optional details", () => {
    const err = new ServiceError("VALIDATION_ERROR", "bad input", { field: "x" });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("bad input");
    expect(err.details).toEqual({ field: "x" });
  });

  it("details is undefined when omitted", () => {
    const err = new ServiceError("NOT_FOUND", "missing");
    expect(err.details).toBeUndefined();
  });
});

describe("withNotFound", () => {
  it("returns the resolved value when the promise succeeds", async () => {
    await expect(withNotFound(Promise.resolve(42), "missing")).resolves.toBe(42);
  });

  it("converts any rejection into a ServiceError NOT_FOUND with the given message", async () => {
    await expect(withNotFound(Promise.reject(new Error("enoent")), "Project not found", { projectId: "X" }))
      .rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found", details: { projectId: "X" } });
  });
});
