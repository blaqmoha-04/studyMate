import { toDto } from '../utils/sql.js';
import { userBounds } from '../utils/time.js';

export function createDashboardService({ db, services }) {
  async function summary(user) {
    const b = await userBounds(db, user.timezone, user.week_start);
    const uid = user.id;
    const [counts, deadlines, exams, classes, activity, study] = await Promise.all([
      db.query(`SELECT
          count(*) FILTER (WHERE status <> 'completed')::int AS pending,
          count(*) FILTER (WHERE status <> 'completed' AND due_at < now())::int AS overdue,
          count(*) FILTER (WHERE status = 'completed')::int AS completed,
          count(*) FILTER (WHERE status = 'completed' AND completed_at >= $2 AND completed_at < $3)::int AS completed_this_week
        FROM assignments WHERE user_id = $1`, [uid, b.weekStart, b.weekEnd]),
      db.query(`SELECT id, title, subject, priority, status, due_at FROM assignments
                 WHERE user_id = $1 AND status <> 'completed' AND due_at >= now() ORDER BY due_at LIMIT 5`, [uid]),
      db.query(`SELECT id, subject, title, exam_at, venue, extract(epoch FROM (exam_at - now()))::bigint AS seconds_until
                  FROM exams WHERE user_id = $1 AND exam_at >= now() ORDER BY exam_at LIMIT 5`, [uid]),
      services.classes.today(user),
      db.query(`(SELECT 'assignment' AS kind, title, CASE WHEN status = 'completed' THEN 'completed' WHEN created_at = updated_at THEN 'added' ELSE 'updated' END AS action, updated_at AS at FROM assignments WHERE user_id = $1)
                UNION ALL (SELECT 'note', title, CASE WHEN created_at = updated_at THEN 'added' ELSE 'updated' END, updated_at FROM study_notes WHERE user_id = $1)
                UNION ALL (SELECT 'exam', subject || ': ' || title, CASE WHEN created_at = updated_at THEN 'added' ELSE 'updated' END, updated_at FROM exams WHERE user_id = $1)
                UNION ALL (SELECT 'class', subject, CASE WHEN created_at = updated_at THEN 'scheduled' ELSE 'updated' END, updated_at FROM class_schedules WHERE user_id = $1)
                UNION ALL (SELECT 'study', CASE WHEN subject = '' THEN 'Study session' ELSE subject END, 'completed', ended_at FROM study_sessions WHERE user_id = $1 AND status = 'completed')
                ORDER BY at DESC LIMIT 8`, [uid]),
      services.study.stats(user),
    ]);
    const c = counts.rows[0];
    return {
      today: b.localDate,
      pendingAssignments: c.pending, overdueAssignments: c.overdue,
      completedAssignments: c.completed, completedThisWeek: c.completed_this_week,
      upcomingExams: exams.rows.length, exams: exams.rows.map((r) => toDto(r)),
      todaysClasses: classes,
      studySecondsThisWeek: study.week, studySecondsToday: study.today,
      upcomingDeadlines: deadlines.rows.map((r) => toDto(r)),
      recentActivity: activity.rows.map((r) => toDto(r)),
    };
  }
  return { summary };
}
