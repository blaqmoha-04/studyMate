import { hashPassword, verifyPassword, DUMMY_HASH, randomToken, hmacToken } from '../utils/crypto.js';
import { AppError, conflict } from '../utils/errors.js';
import { POLICY_VERSION } from '../legal.js';

const RESET_TTL_MS = 60 * 60 * 1000;

export function createAuthService({ db, config, mailer, logger }) {
  async function createSession(q, userId) {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    await q(
      `INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [userId, hmacToken(config.sessionSecret, token), csrfToken, new Date(Date.now() + config.sessionTtlMs)]);
    return { token, csrfToken };
  }

  async function register({ email, name, password, timezone }) {
    const hash = await hashPassword(password);
    try {
      return await db.tx(async (q) => {
        const { rows } = await q(
          `INSERT INTO users (email, name, password_hash, timezone, terms_accepted_at, terms_version) VALUES ($1,$2,$3,$4, now(), $5) RETURNING *`,
          [email, name, hash, timezone ?? 'UTC', POLICY_VERSION]);
        const session = await createSession(q, rows[0].id);
        return { user: rows[0], ...session };
      });
    } catch (err) {
      if (err.code === '23505') throw conflict('An account with this email already exists.');
      throw err;
    }
  }

  async function login({ email, password }, oldSessionId) {
    const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = rows[0];
    // Always run a verification so response time doesn't reveal whether the email exists.
    const ok = await verifyPassword(user?.password_hash ?? DUMMY_HASH, password);
    if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Invalid email or password.');
    return db.tx(async (q) => {
      if (oldSessionId) await q('DELETE FROM sessions WHERE id = $1', [oldSessionId]); // no session fixation
      const session = await createSession(q, user.id);
      return { user, ...session };
    });
  }

  const logout = (sessionId) => db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);

  async function changePassword(user, sessionId, { currentPassword, newPassword }) {
    if (!(await verifyPassword(user.password_hash, currentPassword))) {
      throw new AppError(400, 'wrong_password', 'Current password is incorrect.');
    }
    const hash = await hashPassword(newPassword);
    await db.tx(async (q) => {
      await q('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, hash]);
      // Sign out every other device.
      await q('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [user.id, sessionId]);
    });
  }

  function resetLink(rawToken) {
    const origin = config.publicOrigin ?? `http://localhost:${config.port}`;
    // Token is in the URL fragment so it is never sent to servers, proxies or Referer headers.
    return `${origin}/#/reset-password?token=${rawToken}`;
  }

  async function createResetToken(userId) {
    const raw = randomToken(32);
    await db.tx(async (q) => {
      await q('DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await q(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
        [userId, hmacToken(config.sessionSecret, raw), new Date(Date.now() + RESET_TTL_MS)]);
    });
    return raw;
  }

  function capabilities() {
    return { passwordResetEmail: mailer.configured, devResetLogging: config.devLogResetLinks };
  }

  async function forgotPassword({ email }) {
    if (!mailer.configured && !config.devLogResetLinks) {
      throw new AppError(501, 'email_not_configured',
        'Password reset by email is not available on this server. Ask the administrator to generate a reset link.');
    }
    const { rows } = await db.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
    if (rows[0]) {
      const raw = await createResetToken(rows[0].id);
      if (mailer.configured) {
        // Not awaited: keeps response time identical for existing and unknown emails.
        mailer.send({ to: email, subject: 'Reset your StudyMate password',
          text: `Use this link within 1 hour to choose a new password:\n\n${resetLink(raw)}\n\nIf you did not ask for this, ignore this email.\n\nThis is a one-off account email. StudyMate sends no marketing or newsletters, so there is nothing to unsubscribe from.` })
          .catch((err) => logger.error({ err: err.message }, 'failed to send reset email'));
      } else {
        logger.warn({ userId: rows[0].id, link: resetLink(raw) }, 'DEV ONLY: password reset link (email not configured)');
      }
    }
    return mailer.configured
      ? { message: 'If an account exists for that email, a reset link has been sent.' }
      : { message: 'Email is not configured. In development the reset link was written to the server log.' };
  }

  async function resetPassword({ token, password }) {
    const hash = await hashPassword(password);
    await db.tx(async (q) => {
      const { rows } = await q(
        `SELECT id, user_id FROM password_reset_tokens
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [hmacToken(config.sessionSecret, token)]);
      if (!rows[0]) throw new AppError(400, 'invalid_token', 'This reset link is invalid or has expired.');
      await q('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [rows[0].id]);
      await q('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [rows[0].user_id, hash]);
      await q('DELETE FROM sessions WHERE user_id = $1', [rows[0].user_id]); // invalidate all sessions
    });
  }

  async function purgeExpired() {
    await db.query('DELETE FROM sessions WHERE expires_at < now()');
    await db.query(`DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day' OR used_at < now() - interval '1 day'`);
  }

  return { register, login, logout, changePassword, forgotPassword, resetPassword, createResetToken, resetLink, capabilities, purgeExpired };
}
