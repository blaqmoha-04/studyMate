import { hmacToken } from '../utils/crypto.js';
import { unauthorized } from '../utils/errors.js';

export const COOKIE_NAME = 'sm_sid';

export function cookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlMs,
  };
}

// Loads the session (if any) from the cookie. Identity comes ONLY from here, never from client input.
export function loadSession({ db, config }) {
  return async (req, res, next) => {
    try {
      const raw = req.cookies?.[COOKIE_NAME];
      if (!raw || typeof raw !== 'string' || raw.length > 128) return next();
      const tokenHash = hmacToken(config.sessionSecret, raw);
      const { rows } = await db.query(
        `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.last_seen_at, u.*
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash]);
      if (!rows[0]) { res.clearCookie(COOKIE_NAME, { ...cookieOptions(config), maxAge: undefined }); return next(); }
      const { session_id, csrf_token, expires_at, last_seen_at, ...user } = rows[0];
      req.session = { id: session_id, csrfToken: csrf_token };
      req.user = user;
      // Sliding expiry, written at most every 10 minutes to limit write load.
      if (Date.now() - new Date(last_seen_at).getTime() > 10 * 60_000) {
        const newExpiry = new Date(Date.now() + config.sessionTtlMs);
        await db.query('UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1', [session_id, newExpiry]);
      }
      next();
    } catch (err) { next(err); }
  };
}

export const requireAuth = (req, res, next) => (req.user ? next() : next(unauthorized()));
