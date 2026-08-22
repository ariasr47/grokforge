import { z } from "zod";

/** Loose envelope parse — extra fields pass through for forward compat. */
export const runEventEnvelopeSchema = z.looseObject({
  schemaVersion: z.literal(1),
  eventSeq: z.number().int().positive(),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  type: z.string().min(1),
  connectionGeneration: z.number().int(),
  occurredAt: z.string(),
  payload: z.looseObject({ kind: z.string().min(1) }),
});

export type ParsedRunEvent = z.infer<typeof runEventEnvelopeSchema>;

export function parseRunEventEnvelope(raw: unknown): ParsedRunEvent | null {
  const result = runEventEnvelopeSchema.safeParse(raw);
  return result.success ? result.data : null;
}
