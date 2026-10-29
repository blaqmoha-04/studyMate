export const userDto = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  learningGoal: u.learning_goal ?? '',
  theme: u.theme,
  timezone: u.timezone,
  weekStart: u.week_start,
  notifications: { deadlines: u.notify_deadlines, exams: u.notify_exams, study: u.notify_study },
  createdAt: u.created_at,
});
