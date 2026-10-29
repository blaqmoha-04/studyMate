import crypto from 'node:crypto';
import argon2 from 'argon2';

// OWASP-recommended argon2id baseline (19 MiB, t=2, p=1).
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw) => argon2.hash(pw, ARGON_OPTS);
export const verifyPassword = async (hash, pw) => {
  try { return await argon2.verify(hash, pw); } catch { return false; }
};
// Hash computed once so unknown-email logins cost the same as real ones.
export const DUMMY_HASH = await argon2.hash('studymate-dummy-password', ARGON_OPTS);

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const hmacToken = (secret, token) =>
  crypto.createHmac('sha256', secret).update(token).digest('hex');
export const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};
