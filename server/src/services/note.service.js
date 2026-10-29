import { buildUpdate, likePattern, whereBuilder, pageMeta, toDto } from '../utils/sql.js';
import { notFound, conflict } from '../utils/errors.js';

const COLS = { title: 'title', subject: 'subject', content: 'content', tags: 'tags', pinned: 'pinned' };

export function createNoteService({ db }) {
  const dto = (r) => toDto(r);

  async function list(userId, f) {
    const w = whereBuilder(userId);
    if (f.q) w.add(`(title ILIKE ? ESCAPE '\\' OR content ILIKE ? ESCAPE '\\' OR subject ILIKE ? ESCAPE '\\')`, likePattern(f.q));
    if (f.subject) w.add('lower(subject) = lower(?)', f.subject);
    if (f.tag) w.add('? = ANY(tags)', f.tag.toLowerCase());
    if (f.pinned !== undefined) w.add('pinned = ?', f.pinned);
    const offset = (f.page - 1) * f.pageSize;
    const [rows, count] = await Promise.all([
      // The list returns only a preview; full content comes from GET /notes/:id.
      db.query(`SELECT id, user_id, title, subject, tags, pinned, left(content, 200) AS preview, created_at, updated_at
                  FROM study_notes WHERE ${w.clause()}
                 ORDER BY pinned DESC, updated_at DESC, id LIMIT ${f.pageSize} OFFSET ${offset}`, w.vals),
      db.query(`SELECT count(*)::int AS n FROM study_notes WHERE ${w.clause()}`, w.vals),
    ]);
    return { items: rows.rows.map(dto), meta: pageMeta(f.page, f.pageSize, count.rows[0].n) };
  }

  async function subjectsAndTags(userId) {
    const [s, t] = await Promise.all([
      db.query(`SELECT DISTINCT subject FROM study_notes WHERE user_id = $1 AND subject <> '' ORDER BY subject`, [userId]),
      db.query(`SELECT tag, count(*)::int AS count FROM study_notes, unnest(tags) AS tag WHERE user_id = $1 GROUP BY tag ORDER BY tag`, [userId]),
    ]);
    return { subjects: s.rows.map((r) => r.subject), tags: t.rows };
  }

  async function get(userId, id) {
    const { rows } = await db.query('SELECT * FROM study_notes WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows[0]) throw notFound('Note');
    return dto(rows[0]);
  }

  async function create(userId, b) {
    const { rows } = await db.query(
      `INSERT INTO study_notes (user_id, title, subject, content, tags, pinned) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [userId, b.title, b.subject, b.content, b.tags, b.pinned]);
    return dto(rows[0]);
  }

  async function update(userId, id, { baseUpdatedAt, ...patch }) {
    const { sets, values } = buildUpdate(patch, COLS);
    values.push(id, userId);
    let sql = `UPDATE study_notes SET ${sets.join(', ')}, updated_at = now()
                WHERE id = $${values.length - 1} AND user_id = $${values.length}`;
    if (baseUpdatedAt) { values.push(baseUpdatedAt); sql += ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${values.length}::timestamptz)`; }
    const { rows } = await db.query(`${sql} RETURNING *`, values);
    if (rows[0]) return dto(rows[0]);
    // No row updated: either it doesn't exist (for this user) or someone saved a newer version.
    const current = await get(userId, id); // throws 404 if missing / not owned
    throw conflict('This note was changed somewhere else. Reload to see the latest version.', { current });
  }

  async function remove(userId, id) {
    const r = await db.query('DELETE FROM study_notes WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!r.rowCount) throw notFound('Note');
  }

  return { list, subjectsAndTags, get, create, update, remove };
}
