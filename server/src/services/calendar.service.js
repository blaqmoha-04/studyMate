const ALL = ['assignment', 'class', 'exam', 'study'];
const hhmm = (t) => String(t).slice(0, 5);

export function createCalendarService({ db }) {
  // from/to are local calendar dates (YYYY-MM-DD) in the user's time zone, inclusive.
  async function events(user, { from, to, types }) {
    const want = new Set(types ? types.split(',') : ALL);
    const tz = user.timezone;
    const range = `($2::date)::timestamp AT TIME ZONE $4`;
    const rangeEnd = `(($3::date) + 1)::timestamp AT TIME ZONE $4`;
    const args = [user.id, from, to, tz];
    const out = [];
    const jobs = [];

    if (want.has('assignment')) jobs.push(db.query(
      `SELECT id, title, subject, priority, status, due_at FROM assignments
        WHERE user_id = $1 AND due_at >= ${range} AND due_at < ${rangeEnd}`, args).then(({ rows }) => rows.forEach((r) => out.push({
        id: `assignment:${r.id}`, entityId: r.id, type: 'assignment', title: r.title, start: r.due_at, end: null,
        meta: { subject: r.subject, priority: r.priority, status: r.status, overdue: r.status !== 'completed' && new Date(r.due_at) < new Date() } }))));

    if (want.has('exam')) jobs.push(db.query(
      `SELECT id, title, subject, venue, exam_at FROM exams
        WHERE user_id = $1 AND exam_at >= ${range} AND exam_at < ${rangeEnd}`, args).then(({ rows }) => rows.forEach((r) => out.push({
        id: `exam:${r.id}`, entityId: r.id, type: 'exam', title: `${r.subject}: ${r.title}`, start: r.exam_at, end: null,
        meta: { venue: r.venue } }))));

    if (want.has('study')) jobs.push(db.query(
      `SELECT id, subject, status, planned_start, planned_minutes FROM study_sessions
        WHERE user_id = $1 AND status = 'planned' AND planned_start >= ${range} AND planned_start < ${rangeEnd}`, args)
      .then(({ rows }) => rows.forEach((r) => out.push({
        id: `study:${r.id}`, entityId: r.id, type: 'study', title: r.subject ? `Study: ${r.subject}` : 'Study session',
        start: r.planned_start, end: new Date(new Date(r.planned_start).getTime() + r.planned_minutes * 60000).toISOString(),
        meta: { minutes: r.planned_minutes } }))));

    if (want.has('class')) jobs.push(db.query(
      // Weekly classes are expanded into one event per matching day in the range.
      `SELECT c.id, c.subject, c.lecturer, c.location, c.color, c.start_time, c.end_time, d::date::text AS day,
              ((d::date + c.start_time)::timestamp AT TIME ZONE $4) AS starts_at,
              ((d::date + c.end_time)::timestamp AT TIME ZONE $4) AS ends_at
         FROM class_schedules c
         JOIN generate_series($2::date, $3::date, interval '1 day') d ON extract(dow FROM d) = c.day_of_week
        WHERE c.user_id = $1`, args).then(({ rows }) => rows.forEach((r) => out.push({
        id: `class:${r.id}:${r.day}`, entityId: r.id, type: 'class', title: r.subject, start: r.starts_at, end: r.ends_at,
        color: r.color, meta: { lecturer: r.lecturer, location: r.location, startTime: hhmm(r.start_time), endTime: hhmm(r.end_time) } }))));

    await Promise.all(jobs);
    out.sort((a, b) => new Date(a.start) - new Date(b.start));
    return out;
  }
  return { events };
}
