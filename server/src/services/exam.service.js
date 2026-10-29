import { buildUpdate, whereBuilder, pageMeta, toDto } from '../utils/sql.js';
import { notFound } from '../utils/errors.js';

const COLS = { subject: 'subject', title: 'title', examAt: 'exam_at', venue: 'venue', notes: 'notes' };
const SELECT = `*, extract(epoch FROM (exam_at - now()))::bigint AS seconds_until`;

export function createExamService({ db }) {
  const dto = (r) => toDto(r);

  async function list(userId, f) {
    const w = whereBuilder(userId);
    if (f.when === 'upcoming') w.raw('exam_at >= now()');
    if (f.when === 'past') w.raw('exam_at < now()');
    if (f.subject) w.add('lower(subject) = lower(?)', f.subject);
    const dir = (f.order ?? (f.when === 'past' ? 'desc' : 'asc')) === 'desc' ? 'DESC' : 'ASC';
    const offset = (f.page - 1) * f.pageSize;
    const [rows, count] = await Promise.all([
      db.query(`SELECT ${SELECT} FROM exams WHERE ${w.clause()} ORDER BY exam_at ${dir}, id LIMIT ${f.pageSize} OFFSET ${offset}`, w.vals),
      db.query(`SELECT count(*)::int AS n FROM exams WHERE ${w.clause()}`, w.vals),
    ]);
    return { items: rows.rows.map(dto), meta: pageMeta(f.page, f.pageSize, count.rows[0].n) };
  }

  // An exam is returned together with the study sessions planned/recorded for it.
  async function get(userId, id) {
    const { rows } = await db.query(`SELECT ${SELECT} FROM exams WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!rows[0]) throw notFound('Exam');
    const plan = await db.query(
      `SELECT * FROM study_sessions WHERE exam_id = $1 AND user_id = $2
        ORDER BY coalesce(planned_start, started_at) NULLS LAST`, [id, userId]);
    const studySeconds = plan.rows.filter((s) => s.status === 'completed').reduce((n, s) => n + (s.actual_seconds ?? 0), 0);
    return { ...dto(rows[0]), studyPlan: plan.rows.map((r) => toDto(r)), studySecondsLogged: studySeconds };
  }

  async function create(userId, b) {
    const { rows } = await db.query(
      `INSERT INTO exams (user_id, subject, title, exam_at, venue, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${SELECT}`,
      [userId, b.subject, b.title, b.examAt, b.venue, b.notes]);
    return dto(rows[0]);
  }

  async function update(userId, id, patch) {
    const { sets, values } = buildUpdate(patch, COLS);
    values.push(id, userId);
    const { rows } = await db.query(
      `UPDATE exams SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING ${SELECT}`, values);
    if (!rows[0]) throw notFound('Exam');
    if (patch.examAt !== undefined) {
      await db.query(`UPDATE notifications SET dismissed_at = now() WHERE user_id = $1 AND entity_id = $2 AND dismissed_at IS NULL`, [userId, id]);
    }
    return dto(rows[0]);
  }

  async function remove(userId, id) {
    await db.tx(async (q) => {
      const r = await q('DELETE FROM exams WHERE id = $1 AND user_id = $2', [id, userId]);
      if (!r.rowCount) throw notFound('Exam');
      await q('DELETE FROM notifications WHERE user_id = $1 AND entity_id = $2', [userId, id]);
    });
  }

  return { list, get, create, update, remove };
}
