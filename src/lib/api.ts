import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export function jsonError(status: number, error: string, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

// Wraps a route handler so ApiError/ZodError become typed JSON responses.
export function handle<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) return jsonError(err.status, err.message, err.code);
      if (err instanceof ZodError) {
        return jsonError(400, err.issues[0]?.message ?? "Invalid request", "VALIDATION");
      }
      console.error(err);
      return jsonError(500, "Internal server error");
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body", "VALIDATION");
  }
  return schema.parse(raw);
}
