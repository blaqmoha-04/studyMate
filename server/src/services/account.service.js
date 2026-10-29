import { verifyPassword } from '../utils/crypto.js';
import { AppError, conflict } from '../utils/errors.js';
import { userDto } from '../utils/serialize.js';
import { toDto } from '../utils/sql.js';

export function createAccountService({ db }) {
  async function updateProfile(user, { name, email, learningGoal, currentPassword }) {
    if (email && email !== user.email.toLowerCase()) {
      if (!(await verifyPassword(user.password_hash, currentPassword ?? ''))) {
        throw new AppError(400, 'wrong_password', 'Current password is incorrect.');
      }
    }
    try {
      const { rows } = await db.query(
        `UPDATE users SET name = coalesce($2, name), email = coalesce($3, email), learning_goal = coalesce($4, learning_goal), updated_at = now() WHERE id = $1 RETURNING *`,
        [user.id, name ?? null, email ?? null, learningGoal ?? null]);
      return userDto(rows[0]);
    } catch (err) {
      if (err.code === '23505') throw conflict('That email address is already in use.');
      throw err;
    }
  }

  async function updatePreferences(user, p) {
    const n = p.notifications ?? {};
    const { rows } = await db.query(
      `UPDATE users SET theme = coalesce($2, theme), timezone = coalesce($3, timezone), week_start = coalesce($4, week_start),
              notify_deadlines = coalesce($5, notify_deadlines), notify_exams = coalesce($6, notify_exams),
              notify_study = coalesce($7, notify_study), updated_at = now() WHERE id = $1 RETURNING *`,
      [user.id, p.theme ?? null, p.timezone ?? null, p.weekStart ?? null, n.deadlines ?? null, n.exams ?? null, n.study ?? null]);
    return userDto(rows[0]);
  }

  // Everything we hold about the user, as JSON. Password hashes and session tokens are never included.
  async function exportData(user) {
    const q = (t, order) => db.query(`SELECT * FROM ${t} WHERE user_id = $1 ORDER BY ${order}`, [user.id]).then((r) => r.rows.map((x) => toDto(x)));
    const [assignments, classes, notes, exams, studySessions, notifications, vocabulary, searches] = await Promise.all([
      q('assignments', 'due_at'), q('class_schedules', 'day_of_week, start_time'), q('study_notes', 'created_at'),
      q('exams', 'exam_at'), q('study_sessions', 'created_at'), q('notifications', 'created_at'),
      q('vocabulary', 'word ASC'), q('dictionary_searches', 'searched_at DESC'),
    ]);
    return { exportedAt: new Date().toISOString(), format: 'studymate-export-v1', profile: { ...userDto(user), termsAcceptedAt: user.terms_accepted_at, termsVersion: user.terms_version },
      assignments, classes, notes, exams, studySessions, notifications, vocabulary, searches };
  }

  // "Reset progress": clears finished work and history, keeps the account, timetable, notes, exams,
  // open assignments and planned study sessions.
  async function resetProgress(user, password) {
    if (!(await verifyPassword(user.password_hash, password))) throw new AppError(400, 'wrong_password', 'Password is incorrect.');
    return db.tx(async (q) => {
      const a = await q(`DELETE FROM assignments WHERE user_id = $1 AND status = 'completed'`, [user.id]);
      const s = await q(`DELETE FROM study_sessions WHERE user_id = $1 AND status IN ('completed','cancelled')`, [user.id]);
      const n = await q('DELETE FROM notifications WHERE user_id = $1', [user.id]);
      return { completedAssignmentsDeleted: a.rowCount, studySessionsDeleted: s.rowCount, notificationsDeleted: n.rowCount };
    });
  }

  // Hard delete: ON DELETE CASCADE removes every row owned by the user in one transaction.
  async function deleteAccount(user, password) {
    if (!(await verifyPassword(user.password_hash, password))) {
      throw new AppError(400, 'wrong_password', 'Password is incorrect.');
    }
    await db.tx(async (q) => { await q('DELETE FROM users WHERE id = $1', [user.id]); });
  }

  return { updateProfile, updatePreferences, exportData, resetProgress, deleteAccount };
}
