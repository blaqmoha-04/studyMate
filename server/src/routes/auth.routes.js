import express from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth, COOKIE_NAME, cookieOptions } from '../middleware/session.js';
import { registerBody, loginBody, forgotBody, resetBody, changePasswordBody } from '../validators/auth.js';
import { userDto } from '../utils/serialize.js';
import { unauthorized } from '../utils/errors.js';

export function authRoutes({ config, services, limiters }) {
  const r = express.Router();
  const { auth } = services;
  const setCookie = (res, token) => res.cookie(COOKIE_NAME, token, cookieOptions(config));
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  r.get('/capabilities', (req, res) => res.json({ data: auth.capabilities() }));

  // Current session. 401 when signed out; the client uses this on page load.
  r.get('/session', (req, res, next) => {
    if (!req.user) return next(unauthorized());
    res.json({ data: { user: userDto(req.user), csrfToken: req.session.csrfToken } });
  });

  r.post('/register', limiters.register, validate({ body: registerBody }), wrap(async (req, res) => {
    const { user, token, csrfToken } = await auth.register(req.body);
    setCookie(res, token);
    res.status(201).json({ data: { user: userDto(user), csrfToken } });
  }));

  r.post('/login', limiters.loginIp, limiters.loginAccount, validate({ body: loginBody }), wrap(async (req, res) => {
    const { user, token, csrfToken } = await auth.login(req.body, req.session?.id);
    setCookie(res, token);
    res.json({ data: { user: userDto(user), csrfToken } });
  }));

  r.post('/logout', requireAuth, wrap(async (req, res) => {
    await auth.logout(req.session.id);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(config), maxAge: undefined });
    res.status(204).end();
  }));

  r.post('/forgot-password', limiters.forgot, validate({ body: forgotBody }), wrap(async (req, res) => {
    const result = await auth.forgotPassword(req.body);
    res.status(202).json({ data: result });
  }));

  r.post('/reset-password', limiters.reset, validate({ body: resetBody }), wrap(async (req, res) => {
    await auth.resetPassword(req.body);
    res.json({ data: { message: 'Password updated. Please sign in with your new password.' } });
  }));

  r.post('/change-password', requireAuth, limiters.password, validate({ body: changePasswordBody }), wrap(async (req, res) => {
    await auth.changePassword(req.user, req.session.id, req.body);
    res.json({ data: { message: 'Password changed. Other devices have been signed out.' } });
  }));

  return r;
}
