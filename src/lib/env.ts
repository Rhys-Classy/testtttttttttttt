import { z } from 'zod';

const schema = z.object({
  /** Runtime role connection. Optional on Netlify, where it's derived from Netlify Database (see src/db/connection.ts). */
  DATABASE_URL: z.string().optional(),
  DATABASE_ADMIN_URL: z.string().optional(),
  /** Public https URL. On Netlify, falls back to the site URL the platform provides. */
  APP_URL: z.string().default(process.env.URL ?? 'http://localhost:3000'),
  /** 32+ chars. Used to derive the AES-256-GCM key that encrypts integration secrets. */
  ENCRYPTION_KEY: z.string().min(32),
  STORAGE_DIR: z.string().default('./storage'),
  /** Optional platform-level fallbacks; per-business integrations take priority. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5'),
  SMTP_URL: z.string().optional(),
  NODE_ENV: z.string().default('development'),
  /** Shared secret for the scheduled worker endpoint (/api/cron/worker). */
  CRON_SECRET: z.string().min(24).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
