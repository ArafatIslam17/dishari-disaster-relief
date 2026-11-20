import type { ZodTypeAny, z } from 'zod';

/** Parses untrusted input; a ZodError becomes a 400 in the app error handler (NFR12). */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data) as z.output<S>;
}
