import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  name: z.literal('pharos'),
  version: z.string(),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
