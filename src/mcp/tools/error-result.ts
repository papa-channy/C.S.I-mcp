import { ServiceError } from "../../service/errors.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  // The MCP SDK's CallToolResult type is inferred from a zod schema with z.core.$loose,
  // which carries an index signature — declare it here too so this interface stays
  // structurally assignable to CallToolResult without a cast at every call site.
  [key: string]: unknown;
}

// A ServiceError becomes a structured tool-error result. Anything else is a bug in this layer,
// not a call the taxonomy in the spec covers — rethrow it and let the MCP SDK's own handler-error
// path turn it into a protocol-level error, rather than inventing a fourth error code here.
export function toErrorResult(err: unknown): ToolResult {
  if (err instanceof ServiceError) {
    return {
      content: [{ type: "text", text: err.message }],
      structuredContent: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      isError: true,
    };
  }
  throw err;
}
