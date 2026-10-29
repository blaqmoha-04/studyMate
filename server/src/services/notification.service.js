import { whereBuilder, pageMeta, toDto } from '../utils/sql.js';
import { notFound } from '../utils/errors.js';

export function createNotificationService({ db, logger }) {
  const dto = (r) => toDto(r);

  // Generates in-app notifications from real records. Idempotent: UNIQUE(user_id, dedupe_key)
  // plus ON CONFLICT DO NOTHING means running it any number of times never creates duplicates.
  // userId = null generates for every user (used by the background job).
  async function generate(userId = null) {
    const u = userId;
    const fmt = (col) => `to_char(${col} AT TIME ZONE us.timezone, 'Dy DD Mon HH24:MI')`;
    await db.tx(async (q) => {
      await q(`INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
        SELECT a.user_id, 'assignment_due', 'Due soon: ' || a.title, 'Due ' || ${fmt('a.due_at')},
               'assignment', a.id, 'due:' || a.id || ':' || extract(epoch FROM a.due_at)::bigint
          FROM assignments a JOIN users us ON us.id = a.user_id
         WHERE us.notify_deadlines AND a.status <> 'completed'
           AND a.due_at >= now() AND a.due_at < now() + interval '48 hours'
           AND ($1::uuid IS NULL OR a.user_id = $1)
        ON CONFLICT (user_id, dedupe_key) DO NOTHING`, [u]);
      await q(`INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
        SELECT a.user_id, 'assignment_overdue', 'Overdue: ' || a.title, 'Was due ' || ${fmt('a.due_at')},
               'assignment', a.id, 'overdue:' || a.id || ':' || extract(epoch FROM a.due_at)::bigint
          FROM assignments a JOIN users us ON us.id = a.user_id
         WHERE us.notify_deadlines AND a.status <> 'completed'
           AND a.due_at < now() AND a.due_at > now() - interval '14 days'
           AND ($1::uuid IS NULL OR a.user_id = $1)
        ON CONFLICT (user_id, dedupe_key) DO NOTHING`, [u]);
      await q(`INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
        SELECT e.user_id, 'exam_upcoming', 'Exam coming up: ' || e.subject, e.title || ' on ' || ${fmt('e.exam_at')},
               'exam', e.id, 'exam:' || e.id || ':' || extract(epoch FROM e.exam_at)::bigint
          FROM exams e JOIN users us ON us.id = e.user_id
         WHERE us.notify_exams AND e.exam_at >= now() AND e.exam_at < now() + interval '7 days'
           AND ($1::uuid IS NULL OR e.user_id = $1)
        ON CONFLICT (user_id, dedupe_key) DO NOTHING`, [u]);
      await q(`INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
        SELECT s.user_id, 'study_reminder', 'Study session soon' || CASE WHEN s.subject <> '' THEN ': ' || s.subject ELSE '' END,
               'Planned for ' || ${fmt('s.planned_start')},
               'study_session', s.id, 'study:' || s.id || ':' || extract(epoch FROM s.planned_start)::bigint
          FROM study_sessions s JOIN users us ON us.id = s.user_id
         WHERE us.notify_study AND s.status = 'planned'
           AND s.planned_start >= now() - interval '30 minutes' AND s.planned_start < now() + interval '60 minutes'
           AND ($1::uuid IS NULL OR s.user_id = $1)
        ON CONFLICT (user_id, dedupe_key) DO NOTHING`, [u]);
      // Tidy up: dismissed items older than 30 days.
      await q(`DELETE FROM notifications WHERE dismissed_at < now() - interval '30 days' AND ($1::uuid IS NULL OR user_id = $1)`, [u]);
    });
  }

  async function list(userId, f) {
    await generate(userId); // reminders are produced when you're active; see README for limits
    const w = whereBuilder(userId);
    w.raw('dismissed_at IS NULL');
    if (f.unread) w.raw('read_at IS NULL');
    const offset = (f.page - 1) * f.pageSize;
    const [rows, count, unread] = await Promise.all([
      db.query(`SELECT * FROM notifications WHERE ${w.clause()} ORDER BY created_at DESC, id LIMIT ${f.pageSize} OFFSET ${offset}`, w.vals),
      db.query(`SELECT count(*)::int AS n FROM notifications WHERE ${w.clause()}`, w.vals),
      db.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND dismissed_at IS NULL AND read_at IS NULL`, [userId]),
    ]);
    return { items: rows.rows.map(dto), meta: { ...pageMeta(f.page, f.pageSize, count.rows[0].n), unread: unread.rows[0].n } };
  }

  async function unreadCount(userId) {
    await generate(userId);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND dismissed_at IS NULL AND read_at IS NULL`, [userId]);
    return rows[0].n;
  }

  async function markRead(userId, id) {
    const { rows } = await db.query(
      `UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *`, [id, userId]);
    if (!rows[0]) throw notFound('Notification');
    return dto(rows[0]);
  }
  const markAllRead = async (userId) => (await db.query(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL`, [userId])).rowCount;

  async function dismiss(userId, id) {
    const r = await db.query(`UPDATE notifications SET dismissed_at = now(), read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!r.rowCount) throw notFound('Notification');
  }

  const runForAll = () => generate(null).catch((err) => logger.error({ err: err.message }, 'notification job failed'));

  return { generate, list, unreadCount, markRead, markAllRead, dismiss, runForAll };
}
