import { forbidden } from '../utils/errors.js';
import { safeEqual } from '../utils/crypto.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// Defence in depth for a cookie-authenticated JSON API:
//  1. State-changing requests must be application/json (forces a CORS preflight, which we never allow).
//  2. If the browser sends Origin, it must match our own origin.
//  3. Authenticated state-changing requests must carry the per-session X-CSRF-Token header.
export function originAndContentType(config) {
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      const host = req.get('host');
      const allowed = new Set();
      if (config.publicOrigin) allowed.add(config.publicOrigin);
      if (host) {
        allowed.add(`${req.protocol}://${host}`);
        allowed.add(`http://${host}`);
        allowed.add(`https://${host}`);
      }
      if (!config.isProd) {
        allowed.add(`http://localhost:${config.port}`);
        allowed.add(`http://127.0.0.1:${config.port}`);
        allowed.add(`https://localhost:${config.port}`);
        allowed.add(`https://127.0.0.1:${config.port}`);
      }
      if (!allowed.has(origin)) return next(forbidden('Cross-origin request blocked'));
    }
    const hasBody = Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding');
    if (hasBody && !req.is('application/json')) return next(forbidden('Content-Type must be application/json'));
    next();
  };
}

export function csrfProtection(req, res, next) {
  if (SAFE.has(req.method) || !req.session) return next();
  const supplied = req.get('x-csrf-token');
  if (!supplied || !safeEqual(supplied, req.session.csrfToken)) {
    return next(forbidden('Missing or invalid CSRF token'));
  }
  next();
}
