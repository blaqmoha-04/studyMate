import { whereBuilder, pageMeta, buildUpdate, toDto } from '../utils/sql.js';
import { notFound, conflict, badRequest } from '../utils/errors.js';
import { userBounds } from '../utils/time.js';

const MAX_SESSION_SECONDS = 12 * 3600; // a forgotten timer can't record more than 12h
const COLS = { subject: 'subject', notes: 'notes', plannedStart: 'planned_start', plannedMinutes: 'planned_minutes',
  assignmentId: 'assignment_id', examId: 'exam_id' };

// Elapsed seconds are computed in SQL from server timestamps, never from the browser clock.
const ELAPSED = `(accumulated_seconds + CASE WHEN status = 'running'
    THEN GREATEST(0, extract(epoch FROM (now() - last_resumed_at))::int) ELSE 0 END)`;
const SELECT = `*, ${ELAPSED} AS elapsed_seconds, now() AS server_time`;

export function createStudyService({ db }) {
  const dto = (r) => toDto(r);

  // Foreign keys supplied by the client must belong to the same user (prevents linking to someone else's data).
  async function assertOwned(q, userId, { assignmentId, examId }) {
    if (assignmentId) {
      const r = await q('SELECT 1 FROM assignments WHERE id = $1 AND user_id = $2', [assignmentId, userId]);
      if (!r.rowCount) throw badRequest('Assignment not found', [{ field: 'assignmentId', message: 'Assignment not found' }]);
    }
    if (examId) {
      const r = await q('SELECT 1 FROM exams WHERE id = $1 AND user_id = $2', [examId, userId]);
      if (!r.rowCount) throw badRequest('Exam not found', [{ field: 'examId', message: 'Exam not found' }]);
    }
  }

  const activeError = (err) => {
    if (err.code === '23505' && err.constraint === 'study_sessions_one_active_idx') {
      return conflict('You already have an active study session. Complete or cancel it first.');
    }
    return err;
  };

  async function list(userId, f) {
    const w = whereBuilder(userId);
    if (f.status) w.add('status = ?', f.status);
    if (f.from) w.add('coalesce(ended_at, planned_start, started_at) >= ?', f.from);
    if (f.to) w.add('coalesce(ended_at, planned_start, started_at) <= ?', f.to);
    const offset = (f.page - 1) * f.pageSize;
    const [rows, count] = await Promise.all([
      db.query(`SELECT ${SELECT} FROM study_sessions WHERE ${w.clause()}
                 ORDER BY coalesce(ended_at, started_at, planned_start) DESC, id LIMIT ${f.pageSize} OFFSET ${offset}`, w.vals),
      db.query(`SELECT count(*)::int AS n FROM study_sessions WHERE ${w.clause()}`, w.vals),
    ]);
    return { items: rows.rows.map(dto), meta: pageMeta(f.page, f.pageSize, count.rows[0].n) };
  }

  async function active(userId) {
    const { rows } = await db.query(`SELECT ${SELECT} FROM study_sessions WHERE user_id = $1 AND status IN ('running','paused')`, [userId]);
    return rows[0] ? dto(rows[0]) : null;
  }

  async function get(userId, id) {
    const { rows } = await db.query(`SELECT ${SELECT} FROM study_sessions WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!rows[0]) throw notFound('Study session');
    return dto(rows[0]);
  }

  async function plan(userId, b) {
    await assertOwned(db.query, userId, b);
    const { rows } = await db.query(
      `INSERT INTO study_sessions (user_id, status, subject, notes, planned_start, planned_minutes, assignment_id, exam_id)
       VALUES ($1,'planned',$2,$3,$4,$5,$6,$7) RETURNING ${SELECT}`,
      [userId, b.subject, b.notes, b.plannedStart, b.plannedMinutes, b.assignmentId ?? null, b.examId ?? null]);
    return dto(rows[0]);
  }

  async function updatePlan(userId, id, patch) {
    await assertOwned(db.query, userId, patch);
    const { sets, values } = buildUpdate(patch, COLS);
    values.push(id, userId);
    const { rows } = await db.query(
      `UPDATE study_sessions SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length - 1} AND user_id = $${values.length} AND status = 'planned' RETURNING ${SELECT}`, values);
    if (rows[0]) return dto(rows[0]);
    await get(userId, id); // 404 if not found / not owned
    throw conflict('Only planned sessions can be edited.');
  }

  async function start(userId, b) {
    try {
      return await db.tx(async (q) => {
        await assertOwned(q, userId, b);
        let rows;
        if (b.fromPlannedId) {
          ({ rows } = await q(
            `UPDATE study_sessions SET status = 'running', started_at = now(), last_resumed_at = now(),
                    accumulated_seconds = 0, focus_minutes = coalesce($3, focus_minutes), break_minutes = coalesce($4, break_minutes),
                    updated_at = now()
              WHERE id = $1 AND user_id = $2 AND status = 'planned' RETURNING id`,
            [b.fromPlannedId, userId, b.focusMinutes ?? null, b.breakMinutes ?? null]));
          if (!rows[0]) throw notFound('Planned study session');
        } else {
          ({ rows } = await q(
            `INSERT INTO study_sessions (user_id, status, subject, assignment_id, exam_id, focus_minutes, break_minutes, started_at, last_resumed_at)
             VALUES ($1,'running',$2,$3,$4,coalesce($5,25),coalesce($6,5),now(),now()) RETURNING id`,
            [userId, b.subject ?? '', b.assignmentId ?? null, b.examId ?? null, b.focusMinutes ?? null, b.breakMinutes ?? null]));
        }
        const r = await q(`SELECT ${SELECT} FROM study_sessions WHERE id = $1`, [rows[0].id]);
        return dto(r.rows[0]);
      });
    } catch (err) { throw activeError(err); }
  }

  // Each transition is a single conditional UPDATE, so concurrent clicks can't double-count time.
  async function transition(userId, id, sql, params, wrongState) {
    const { rows } = await db.query(sql, [id, userId, ...params]);
    if (rows[0]) return get(userId, id);
    const s = await get(userId, id); // 404 if not found / not owned
    throw conflict(wrongState(s.status));
  }

  const pause = (userId, id) => transition(userId, id,
    `UPDATE study_sessions SET status = 'paused', accumulated_seconds = ${ELAPSED}, last_resumed_at = NULL, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'running' RETURNING id`, [], (s) => `Cannot pause a ${s} session.`);

  const resume = (userId, id) => transition(userId, id,
    `UPDATE study_sessions SET status = 'running', last_resumed_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'paused' RETURNING id`, [], (s) => `Cannot resume a ${s} session.`);

  const complete = (userId, id) => transition(userId, id,
    `UPDATE study_sessions SET status = 'completed', ended_at = now(),
            actual_seconds = LEAST(${ELAPSED}, ${MAX_SESSION_SECONDS}), accumulated_seconds = LEAST(${ELAPSED}, ${MAX_SESSION_SECONDS}),
            last_resumed_at = NULL, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('running','paused') RETURNING id`, [], (s) => `Cannot complete a ${s} session.`);

  const cancel = (userId, id) => transition(userId, id,
    `UPDATE study_sessions SET status = 'cancelled', ended_at = now(), last_resumed_at = NULL, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('planned','running','paused') RETURNING id`, [], (s) => `Cannot cancel a ${s} session.`);

  async function remove(userId, id) {
    const r = await db.query(`DELETE FROM study_sessions WHERE id = $1 AND user_id = $2 AND status NOT IN ('running','paused')`, [id, userId]);
    if (r.rowCount) return;
    await get(userId, id);
    throw conflict('Complete or cancel an active session before deleting it.');
  }

  async function stats(user) {
    const b = await userBounds(db, user.timezone, user.week_start);
    const [byDay, bySubject, total] = await Promise.all([
      db.query(`SELECT (ended_at AT TIME ZONE $2)::date::text AS day, sum(actual_seconds)::int AS seconds, count(*)::int AS sessions
                  FROM study_sessions WHERE user_id = $1 AND status = 'completed' AND ended_at >= $3 AND ended_at < $4 GROUP BY 1`,
        [user.id, user.timezone, b.weekStart, b.weekEnd]),
      db.query(`SELECT CASE WHEN subject = '' THEN 'Unspecified' ELSE subject END AS subject, sum(actual_seconds)::int AS seconds
                  FROM study_sessions WHERE user_id = $1 AND status = 'completed' AND ended_at >= $2 AND ended_at < $3
                 GROUP BY 1 ORDER BY 2 DESC`, [user.id, b.weekStart, b.weekEnd]),
      db.query(`SELECT coalesce(sum(actual_seconds),0)::int AS seconds, count(*)::int AS sessions
                  FROM study_sessions WHERE user_id = $1 AND status = 'completed'`, [user.id]),
    ]);
    const map = new Map(byDay.rows.map((r) => [r.day, r]));
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(`${b.weekStartDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, seconds: map.get(key)?.seconds ?? 0, sessions: map.get(key)?.sessions ?? 0 });
    }
    return {
      today: days.find((d) => d.date === b.localDate)?.seconds ?? 0,
      week: days.reduce((n, d) => n + d.seconds, 0),
      days, bySubject: bySubject.rows,
      allTime: total.rows[0],
    };
  }

  return { list, active, get, plan, updatePlan, start, pause, resume, complete, cancel, remove, stats };
}
