import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is parsed once, at boot. A missing or malformed variable stops
 * the process immediately rather than surfacing as a runtime failure later.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  DIRECT_DATABASE_URL: z.string().optional(),

  SUPABASE_URL: z.string().url('SUPABASE_URL must be the full https project URL'),
  SUPABASE_SECRET_KEY: z.string().min(1, 'SUPABASE_SECRET_KEY is required'),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1, 'SUPABASE_PUBLISHABLE_KEY is required'),
  SUPABASE_STORAGE_BUCKET: z.string().default('probild-documents'),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
  DEFAULT_CURRENCY: z.enum(['INR', 'USD']).default('INR'),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  // --- Documents ---
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(20),

  // Single-service deployment: serve the built web client from this process,
  // and run the automation worker alongside the HTTP server.
  SERVE_WEB: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  WEB_DIST_DIR: z.string().default('../web/dist'),
  RUN_WORKER: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  // --- Outbound email, for sending documents to clients ---
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  MAIL_FROM_NAME: z.string().default('Probild'),
  MAIL_FROM_ADDRESS: z.string().optional(),
  MAIL_REPLY_TO: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@probild.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe123!'),
  SEED_ADMIN_FIRST_NAME: z.string().default('Probild'),
  SEED_ADMIN_LAST_NAME: z.string().default('Admin'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Tests run against a separate schema so they can truncate freely. */
export const databaseUrl =
  isTest && env.TEST_DATABASE_URL ? env.TEST_DATABASE_URL : env.DATABASE_URL;

/**
 * Tests write to their own bucket for the same reason they use their own schema:
 * dev and test share one Supabase project, and the suite deletes what it uploads.
 */
export const storageBucket = isTest
  ? `${env.SUPABASE_STORAGE_BUCKET}-test`
  : env.SUPABASE_STORAGE_BUCKET;
