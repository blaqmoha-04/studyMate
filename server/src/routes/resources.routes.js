import { Readable, pipeline } from 'node:stream';
import express from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth, COOKIE_NAME, cookieOptions } from '../middleware/session.js';
import { h } from '../utils/http.js';
import { uuidParam } from '../validators/common.js';
import * as v from '../validators/resources.js';
import * as dictVal from '../validators/dictionary.js';

const idParams = { params: uuidParam };

export function resourceRoutes({ config, services: s, limiters }) {
  const r = express.Router();
  // Everything below needs a valid session; identity = req.user (never client input).
  // Scoped to our own prefixes so unknown URLs still get a plain 404.
  r.use(['/me', '/dashboard', '/calendar', '/assignments', '/classes', '/notes', '/exams', '/study-sessions', '/notifications', '/dictionary'], requireAuth);
  const uid = (req) => req.user.id;

  // ---------------------------------------------------------------- account
  r.get('/me', (req, res) => res.json({ data: { ...s.auth.dto(req.user), csrfToken: req.session.csrfToken } }));
  r.patch('/me', limiters.password, validate({ body: v.profilePatch }), h(async (req, res) =>
    res.json({ data: await s.account.updateProfile(req.user, req.body) })));
  r.patch('/me/preferences', validate({ body: v.preferencesPatch }), h(async (req, res) =>
    res.json({ data: await s.account.updatePreferences(req.user, req.body) })));
  r.get('/me/export', limiters.password, h(async (req, res) => {
    const data = await s.account.exportData(req.user);
    res.set('Content-Disposition', 'attachment; filename="studymate-export.json"');
    res.json(data);
  }));
  r.post('/me/reset-progress', limiters.password, validate({ body: v.resetProgressBody }), h(async (req, res) =>
    res.json({ data: await s.account.resetProgress(req.user, req.body.password) })));
  r.delete('/me', limiters.password, validate({ body: v.deleteAccountBody }), h(async (req, res) => {
    await s.account.deleteAccount(req.user, req.body.password);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(config), maxAge: undefined });
    res.status(204).end();
  }));

  // ---------------------------------------------------------------- dashboard & calendar
  r.get('/dashboard', h(async (req, res) => res.json({ data: await s.dashboard.summary(req.user) })));
  r.get('/calendar/events', validate({ query: v.calendarQuery }), h(async (req, res) =>
    res.json({ data: await s.calendar.events(req.user, req.query) })));

  // ---------------------------------------------------------------- assignments
  r.get('/assignments', validate({ query: v.assignmentQuery }), h(async (req, res) => {
    const { items, meta } = await s.assignments.list(uid(req), req.query); res.json({ data: items, meta });
  }));
  r.post('/assignments', validate({ body: v.assignmentCreate }), h(async (req, res) =>
    res.status(201).json({ data: await s.assignments.create(uid(req), req.body) })));
  r.get('/assignments/:id', validate(idParams), h(async (req, res) =>
    res.json({ data: await s.assignments.get(uid(req), req.params.id) })));
  r.patch('/assignments/:id', validate({ ...idParams, body: v.assignmentPatch }), h(async (req, res) =>
    res.json({ data: await s.assignments.update(uid(req), req.params.id, req.body) })));
  r.post('/assignments/:id/complete', validate(idParams), h(async (req, res) =>
    res.json({ data: await s.assignments.complete(uid(req), req.params.id) })));
  r.delete('/assignments/:id', validate(idParams), h(async (req, res) => {
    await s.assignments.remove(uid(req), req.params.id); res.status(204).end();
  }));

  // ---------------------------------------------------------------- classes
  r.get('/classes', h(async (req, res) => { const { items, meta } = await s.classes.list(uid(req)); res.json({ data: items, meta }); }));
  r.get('/classes/today', h(async (req, res) => res.json({ data: await s.classes.today(req.user) })));
  r.post('/classes', validate({ body: v.classCreate }), h(async (req, res) => {
    const { item, warnings } = await s.classes.create(uid(req), req.body); res.status(201).json({ data: item, meta: { warnings } });
  }));
  r.get('/classes/:id', validate(idParams), h(async (req, res) => res.json({ data: await s.classes.get(uid(req), req.params.id) })));
  r.patch('/classes/:id', validate({ ...idParams, body: v.classPatch }), h(async (req, res) => {
    const { item, warnings } = await s.classes.update(uid(req), req.params.id, req.body); res.json({ data: item, meta: { warnings } });
  }));
  r.delete('/classes/:id', validate(idParams), h(async (req, res) => { await s.classes.remove(uid(req), req.params.id); res.status(204).end(); }));

  // ---------------------------------------------------------------- notes
  r.get('/notes', validate({ query: v.noteQuery }), h(async (req, res) => {
    const { items, meta } = await s.notes.list(uid(req), req.query); res.json({ data: items, meta });
  }));
  r.get('/notes/meta', h(async (req, res) => res.json({ data: await s.notes.subjectsAndTags(uid(req)) })));
  r.post('/notes', validate({ body: v.noteCreate }), h(async (req, res) => res.status(201).json({ data: await s.notes.create(uid(req), req.body) })));
  r.get('/notes/:id', validate(idParams), h(async (req, res) => res.json({ data: await s.notes.get(uid(req), req.params.id) })));
  r.patch('/notes/:id', validate({ ...idParams, body: v.notePatch }), h(async (req, res) =>
    res.json({ data: await s.notes.update(uid(req), req.params.id, req.body) })));
  r.delete('/notes/:id', validate(idParams), h(async (req, res) => { await s.notes.remove(uid(req), req.params.id); res.status(204).end(); }));

  // ---------------------------------------------------------------- exams
  r.get('/exams', validate({ query: v.examQuery }), h(async (req, res) => {
    const { items, meta } = await s.exams.list(uid(req), req.query); res.json({ data: items, meta });
  }));
  r.post('/exams', validate({ body: v.examCreate }), h(async (req, res) => res.status(201).json({ data: await s.exams.create(uid(req), req.body) })));
  r.get('/exams/:id', validate(idParams), h(async (req, res) => res.json({ data: await s.exams.get(uid(req), req.params.id) })));
  r.patch('/exams/:id', validate({ ...idParams, body: v.examPatch }), h(async (req, res) =>
    res.json({ data: await s.exams.update(uid(req), req.params.id, req.body) })));
  r.delete('/exams/:id', validate(idParams), h(async (req, res) => { await s.exams.remove(uid(req), req.params.id); res.status(204).end(); }));

  // ---------------------------------------------------------------- study sessions
  r.get('/study-sessions', validate({ query: v.studyQuery }), h(async (req, res) => {
    const { items, meta } = await s.study.list(uid(req), req.query); res.json({ data: items, meta });
  }));
  r.get('/study-sessions/active', h(async (req, res) => res.json({ data: await s.study.active(uid(req)) })));
  r.get('/study-sessions/stats', h(async (req, res) => res.json({ data: await s.study.stats(req.user) })));
  r.post('/study-sessions/plan', validate({ body: v.studyPlanCreate }), h(async (req, res) =>
    res.status(201).json({ data: await s.study.plan(uid(req), req.body) })));
  r.post('/study-sessions/start', validate({ body: v.studyStart }), h(async (req, res) =>
    res.status(201).json({ data: await s.study.start(uid(req), req.body) })));
  r.get('/study-sessions/:id', validate(idParams), h(async (req, res) => res.json({ data: await s.study.get(uid(req), req.params.id) })));
  r.patch('/study-sessions/:id', validate({ ...idParams, body: v.studyPlanPatch }), h(async (req, res) =>
    res.json({ data: await s.study.updatePlan(uid(req), req.params.id, req.body) })));
  for (const action of ['pause', 'resume', 'complete', 'cancel']) {
    r.post(`/study-sessions/:id/${action}`, validate(idParams), h(async (req, res) =>
      res.json({ data: await s.study[action](uid(req), req.params.id) })));
  }
  r.delete('/study-sessions/:id', validate(idParams), h(async (req, res) => { await s.study.remove(uid(req), req.params.id); res.status(204).end(); }));

  // ---------------------------------------------------------------- notifications
  r.get('/notifications', validate({ query: v.notificationQuery }), h(async (req, res) => {
    const { items, meta } = await s.notifications.list(uid(req), req.query); res.json({ data: items, meta });
  }));
  r.get('/notifications/unread-count', h(async (req, res) => res.json({ data: { unread: await s.notifications.unreadCount(uid(req)) } })));
  r.post('/notifications/read-all', h(async (req, res) => res.json({ data: { updated: await s.notifications.markAllRead(uid(req)) } })));
  r.post('/notifications/:id/read', validate(idParams), h(async (req, res) => res.json({ data: await s.notifications.markRead(uid(req), req.params.id) })));
  r.delete('/notifications/:id', validate(idParams), h(async (req, res) => { await s.notifications.dismiss(uid(req), req.params.id); res.status(204).end(); }));

  // ---------------------------------------------------------------- dictionary
  r.get('/dictionary/lookup', validate({ query: dictVal.dictionaryLookupQuery }), h(async (req, res) =>
    res.json({ data: await s.dictionary.lookup(uid(req), req.query.word) })));
  r.get('/dictionary/daily', h(async (req, res) =>
    res.json({ data: await s.dictionary.getDailyWord() })));
  r.get('/dictionary/audio', validate({ query: dictVal.dictionaryAudioQuery }), h(async (req, res) => {
    const { body, contentType, length } = await s.dictionary.fetchAudio(req.query.url);
    res.set('Content-Type', contentType);
    if (length) res.set('Content-Length', String(length));
    pipeline(Readable.fromWeb(body), res, () => {});
  }));
  r.get('/dictionary/vocabulary', validate({ query: dictVal.vocabularyQuery }), h(async (req, res) => {
    const { items, meta } = await s.dictionary.listVocabulary(uid(req), req.query);
    res.json({ data: items, meta });
  }));
  r.post('/dictionary/vocabulary', validate({ body: dictVal.vocabularySaveBody }), h(async (req, res) =>
    res.status(201).json({ data: await s.dictionary.saveVocabulary(uid(req), req.body) })));
  r.get('/dictionary/vocabulary/:id', validate(idParams), h(async (req, res) =>
    res.json({ data: await s.dictionary.getVocabulary(uid(req), req.params.id) })));
  r.delete('/dictionary/vocabulary/:id', validate(idParams), h(async (req, res) => {
    await s.dictionary.removeVocabulary(uid(req), req.params.id);
    res.status(204).end();
  }));
  r.get('/dictionary/recent', validate({ query: dictVal.recentQuery }), h(async (req, res) =>
    res.json({ data: await s.dictionary.recentSearches(uid(req), req.query.limit) })));
  r.delete('/dictionary/recent', h(async (req, res) => {
    await s.dictionary.clearRecentSearches(uid(req));
    res.status(204).end();
  }));

  return r;
}
