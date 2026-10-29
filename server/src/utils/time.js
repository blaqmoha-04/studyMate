// Day/week boundaries are computed by PostgreSQL in the user's own time zone,
// so "today" and "this week" are correct for the person using the app.
export async function userBounds(db, tz, weekStart) {
  const { rows } = await db.query(
    `WITH l AS (SELECT (now() AT TIME ZONE $1)::date AS d, $2::int AS ws)
     SELECT d::text AS local_date,
            extract(dow FROM d)::int AS dow,
            (d::timestamp AT TIME ZONE $1) AS day_start,
            ((d + 1)::timestamp AT TIME ZONE $1) AS day_end,
            ((d - ((extract(dow FROM d)::int - ws + 7) % 7))::timestamp AT TIME ZONE $1) AS week_start,
            ((d - ((extract(dow FROM d)::int - ws + 7) % 7) + 7)::timestamp AT TIME ZONE $1) AS week_end,
            ((d - ((extract(dow FROM d)::int - ws + 7) % 7)))::text AS week_start_date
       FROM l`, [tz, weekStart]);
  const r = rows[0];
  return { localDate: r.local_date, dow: r.dow, dayStart: r.day_start, dayEnd: r.day_end,
    weekStart: r.week_start, weekEnd: r.week_end, weekStartDate: r.week_start_date };
}
