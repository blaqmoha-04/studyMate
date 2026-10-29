import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  // Used as an HMAC key ("pepper") for session and reset tokens. Min 32 chars.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 7),
  // Public origin of the site, e.g. https://studymate.example.com (no trailing slash).
  PUBLIC_ORIGIN: z.string().optional(),
  // Number of reverse proxies in front of the app (Nginx = 1). Needed for correct client IPs.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  COOKIE_SECURE: bool.optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_MULTIPLIER: z.coerce.number().min(0.1).max(10000).default(1),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  // Development only: write password-reset links to the server log when SMTP is not configured.
  DEV_LOG_RESET_LINKS: bool.default(false),
  CLIENT_DIR: z.string().optional(),
  // Who runs this installation (shown on the legal pages). Required for a public deployment.
  OPERATOR_NAME: z.string().max(200).optional(),
  OPERATOR_ADDRESS: z.string().max(500).optional(),
  OPERATOR_EMAIL: z.string().max(254).optional(),
  OPERATOR_JURISDICTION: z.string().max(100).optional(),   // governing law, e.g. "Ghana"
  OPERATOR_PROCESSORS: z.string().max(500).optional(),     // outside service providers, e.g. "Acme Hosting (servers)"
  BACKUP_KEEP_DAYS: z.coerce.number().int().min(1).max(3650).default(14),
  DICTIONARY_PROVIDER: z.string().default('dictionaryapi.dev'),
  DICTIONARY_BASE_URL: z.string().url().optional(),
  DICTIONARY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(8000),
});

// A value that begins with '#' is a stray inline comment from an .env file, not real data.
const clean = (v) => { const s = v?.trim(); return s && !s.startsWith('#') ? s : null; };

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === 'production';
  if (isProd) {
    if (!c.PUBLIC_ORIGIN || !c.PUBLIC_ORIGIN.startsWith('https://')) {
      throw new Error('Invalid configuration: PUBLIC_ORIGIN must be an https:// URL in production');
    }
    if (/change[-_ ]?me|example|placeholder/i.test(c.SESSION_SECRET)) {
      throw new Error('Invalid configuration: SESSION_SECRET still looks like a placeholder');
    }
  }
  return {
    env: c.NODE_ENV,
    isProd,
    isTest: c.NODE_ENV === 'test',
    port: c.PORT,
    host: c.HOST,
    databaseUrl: c.DATABASE_URL,
    dbPoolMax: c.DB_POOL_MAX,
    sessionSecret: c.SESSION_SECRET,
    sessionTtlMs: c.SESSION_TTL_HOURS * 3600 * 1000,
    publicOrigin: c.PUBLIC_ORIGIN?.replace(/\/+$/, '') || null,
    trustProxy: c.TRUST_PROXY,
    cookieSecure: c.COOKIE_SECURE ?? isProd,
    logLevel: c.LOG_LEVEL,
    rateLimitMultiplier: c.RATE_LIMIT_MULTIPLIER,
    smtpUrl: c.SMTP_URL || null,
    mailFrom: c.MAIL_FROM || 'StudyMate <no-reply@localhost>',
    // Never honoured in production, regardless of the variable.
    devLogResetLinks: !isProd && c.DEV_LOG_RESET_LINKS,
    clientDir: c.CLIENT_DIR || null,
    operator: {
      name: clean(c.OPERATOR_NAME), address: clean(c.OPERATOR_ADDRESS), email: clean(c.OPERATOR_EMAIL),
      jurisdiction: clean(c.OPERATOR_JURISDICTION), processors: clean(c.OPERATOR_PROCESSORS),
    },
    backupKeepDays: c.BACKUP_KEEP_DAYS,
    dictionary: {
      provider: c.DICTIONARY_PROVIDER,
      baseUrl: c.DICTIONARY_BASE_URL || undefined,
      timeoutMs: c.DICTIONARY_TIMEOUT_MS,
    },
  };
}
