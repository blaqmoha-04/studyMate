import { buildUpdate, toDto } from '../utils/sql.js';
import { notFound, badRequest } from '../utils/errors.js';
import { userBounds } from '../utils/time.js';

const COLS = { subject: 'subject', lecturer: 'lecturer', location: 'location', dayOfWeek: 'day_of_week',
  startTime: 'start_time', endTime: 'end_time', color: 'color' };
const hhmm = (t) => String(t).slice(0, 5);

export function createClassService({ db }) {
  const dto = (r) => { const o = toDto(r); o.startTime = hhmm(o.startTime); o.endTime = hhmm(o.endTime); return o; };

  async function findConflicts(q, userId, c, excludeId = null) {
    const { rows } = await q(
      `SELECT * FROM class_schedules
        WHERE user_id = $1 AND day_of_week = $2 AND start_time < $4::time AND end_time > $3::time
          AND ($5::uuid IS NULL OR id <> $5)`, [userId, c.dayOfWeek, c.startTime, c.endTime, excludeId]);
    return rows.map((r) => ({ id: r.id, subject: r.subject, startTime: hhmm(r.start_time), endTime: hhmm(r.end_time) }));
  }

  async function list(userId) {
    const { rows } = await db.query(
      'SELECT * FROM class_schedules WHERE user_id = $1 ORDER BY day_of_week, start_time', [userId]);
    const items = rows.map(dto);
    // Flag overlapping classes on the same day.
    const conflicts = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i]; const b = items[j];
      if (a.dayOfWeek === b.dayOfWeek && a.startTime < b.endTime && b.startTime < a.endTime) conflicts.push([a.id, b.id]);
    }
    const flagged = new Set(conflicts.flat());
    return { items: items.map((c) => ({ ...c, hasConflict: flagged.has(c.id) })), meta: { conflicts } };
  }

  async function today(user) {
    const b = await userBounds(db, user.timezone, user.week_start);
    const { rows } = await db.query(
      'SELECT * FROM class_schedules WHERE user_id = $1 AND day_of_week = $2 ORDER BY start_time', [user.id, b.dow]);
    return rows.map(dto);
  }

  async function get(userId, id) {
    const { rows } = await db.query('SELECT * FROM class_schedules WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows[0]) throw notFound('Class');
    return dto(rows[0]);
  }

  async function create(userId, b) {
    const warnings = await findConflicts(db.query, userId, b);
    const { rows } = await db.query(
      `INSERT INTO class_schedules (user_id, subject, lecturer, location, day_of_week, start_time, end_time, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [userId, b.subject, b.lecturer, b.location, b.dayOfWeek, b.startTime, b.endTime, b.color]);
    return { item: dto(rows[0]), warnings };
  }

  async function update(userId, id, patch) {
    const current = await get(userId, id);
    const merged = { ...current, ...patch };
    if (merged.endTime <= merged.startTime) throw badRequest('End time must be after start time', [{ field: 'endTime', message: 'End time must be after start time' }]);
    const warnings = await findConflicts(db.query, userId, merged, id);
    const { sets, values } = buildUpdate(patch, COLS);
    values.push(id, userId);
    const { rows } = await db.query(
      `UPDATE class_schedules SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING *`, values);
    return { item: dto(rows[0]), warnings };
  }

  async function remove(userId, id) {
    const r = await db.query('DELETE FROM class_schedules WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!r.rowCount) throw notFound('Class');
  }

  return { list, today, get, create, update, remove };
}
