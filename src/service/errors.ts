export type ErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "PRECONDITION_FAILED";

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.details = details;
  }
}

export async function withNotFound<T>(
  promise: Promise<T>,
  message: string,
  details?: Record<string, unknown>
): Promise<T> {
  try {
    return await promise;
  } catch {
    throw new ServiceError("NOT_FOUND", message, details);
  }
}
