-- Destroys ALL StudyMate data. Take a backup first.
DROP TABLE IF EXISTS notifications, study_sessions, exams, study_notes, class_schedules,
  assignments, password_reset_tokens, sessions, users CASCADE;
