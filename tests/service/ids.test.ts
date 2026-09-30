import { describe, expect, it } from "vitest";
import { generateUuid, nextSequentialId } from "../../src/service/ids.js";

describe("generateUuid", () => {
  it("returns a v4 UUID string", () => {
    expect(generateUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("returns a different value on each call", () => {
    expect(generateUuid()).not.toBe(generateUuid());
  });
});

describe("nextSequentialId", () => {
  it("returns PREFIX-001 for the first id (existingCount 0)", () => {
    expect(nextSequentialId("FND", 0)).toBe("FND-001");
  });

  it("zero-pads to 3 digits", () => {
    expect(nextSequentialId("EVD", 11)).toBe("EVD-012");
  });

  it("does not truncate beyond 3 digits", () => {
    expect(nextSequentialId("FND", 999)).toBe("FND-1000");
  });
});
