import { rateLimit } from 'express-rate-limit';

export function createLimiters(config) {
  const m = config.rateLimitMultiplier;
  const make = (windowMs, limit, message, keyGenerator) => rateLimit({
    windowMs, limit: Math.max(1, Math.round(limit * m)),
    standardHeaders: 'draft-7', legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    validate: { keyGeneratorIpFallback: false },
    handler: (req, res) => res.status(429).json({ error: { code: 'rate_limited', message, requestId: req.id } }),
  });
  const ip = (req) => req.ip ?? 'unknown';
  const ipEmail = (req) => `${ip(req)}|${String(req.body?.email ?? '').toLowerCase().slice(0, 254)}`;
  const tooMany = 'Too many attempts. Please wait a while and try again.';
  return {
    // per IP+email stops targeted guessing; per IP stops spraying many emails
    loginAccount: make(15 * 60_000, 8, tooMany, ipEmail),
    loginIp: make(15 * 60_000, 40, tooMany, ip),
    register: make(60 * 60_000, 10, tooMany, ip),
    forgot: make(60 * 60_000, 6, tooMany, ip),
    reset: make(60 * 60_000, 15, tooMany, ip),
    password: make(15 * 60_000, 10, tooMany, (req) => req.user?.id ?? ip(req)),
    api: make(60_000, 600, 'Too many requests. Slow down a little.', ip),
  };
}
