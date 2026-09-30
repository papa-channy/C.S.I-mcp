import { randomUUID } from "node:crypto";

export function generateUuid(): string {
  return randomUUID();
}

export function nextSequentialId(prefix: string, existingCount: number): string {
  return `${prefix}-${String(existingCount + 1).padStart(3, "0")}`;
}
