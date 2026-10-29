import { buildUpdate, likePattern, whereBuilder, pageMeta, toDto } from '../utils/sql.js';
import { notFound } from '../utils/errors.js';

const COLS = { title: 'title', description: 'description', subject: 'subject', priority: 'priority',
  status: 'status', dueAt: 'due_at', estimatedMinutes: 'estimated_minutes' };
const SELECT = `*, (status <> 'completed' AND due_at < now()) AS is_overdue`;
const PRIORITY_RANK = `CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`;
const SORTS = { due: 'due_at', priority: PRIORITY_RANK, created: 'created_at' };

export function createAssignmentService({ db }) {
  const dto = (r) => toDto(r);

  async function list(userId, f) {
    const w = whereBuilder(userId);
    if (f.status) w.add('status = ?', f.status);
    if (f.priority) w.add('priority = ?', f.priority);
    if (f.subject) w.add('lower(subject) = lower(?)', f.subject);
    if (f.q) w.add(`(title ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\' OR subject ILIKE ? ESCAPE '\\')`, likePattern(f.q));
    if (f.overdue) w.raw(`status <> 'completed' AND due_at < now()`);
    if (f.dueFrom) w.add('due_at >= ?', f.dueFrom);
    if (f.dueTo) w.add('due_at <= ?', f.dueTo);
    const dir = f.order === 'desc' ? 'DESC' : 'ASC';
    const limit = f.pageSize; const offset = (f.page - 1) * f.pageSize;
    const [rows, count] = await Promise.all([
      db.query(`SELECT ${SELECT} FROM assignments WHERE ${w.clause()}
                ORDER BY ${SORTS[f.sort]} ${dir}, due_at ASC, id
                LIMIT ${limit} OFFSET ${offset}`, w.vals),
      db.query(`SELECT count(*)::int AS n FROM assignments WHERE ${w.clause()}`, w.vals),
    ]);
    return { items: rows.rows.map(dto), meta: pageMeta(f.page, f.pageSize, count.rows[0].n) };
  }

  async function get(userId, id) {
    const { rows } = await db.query(`SELECT ${SELECT} FROM assignments WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!rows[0]) throw notFound('Assignment');
    return dto(rows[0]);
  }

  async function create(userId, b) {
    const { rows } = await db.query(
      `INSERT INTO assignments (user_id, title, description, subject, priority, status, due_at, estimated_minutes, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $6 = 'completed' THEN now() END)
       RETURNING ${SELECT}`,
      [userId, b.title, b.description, b.subject, b.priority, b.status, b.dueAt, b.estimatedMinutes ?? null]);
    return dto(rows[0]);
  }

  async function update(userId, id, patch) {
    const { sets, values } = buildUpdate(patch, COLS);
    if (patch.status !== undefined) {
      sets.push(patch.status === 'completed' ? 'completed_at = COALESCE(completed_at, now())' : 'completed_at = NULL');
    }
    values.push(id, userId);
    const { rows } = await db.query(
      `UPDATE assignments SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING ${SELECT}`, values);
    if (!rows[0]) throw notFound('Assignment');
    if (patch.status === 'completed' || patch.dueAt !== undefined) await dismissRelated(userId, id);
    return dto(rows[0]);
  }

  // Notifications about a completed/rescheduled assignment are stale: dismiss them.
  const dismissRelated = (userId, id) => db.query(
    `UPDATE notifications SET dismissed_at = now() WHERE user_id = $1 AND entity_id = $2 AND dismissed_at IS NULL`, [userId, id]);

  const complete = (userId, id) => update(userId, id, { status: 'completed' });

  async function remove(userId, id) {
    await db.tx(async (q) => {
      const r = await q('DELETE FROM assignments WHERE id = $1 AND user_id = $2', [id, userId]);
      if (!r.rowCount) throw notFound('Assignment');
      await q('DELETE FROM notifications WHERE user_id = $1 AND entity_id = $2', [userId, id]);
    });
  }

  return { list, get, create, update, complete, remove };
}
