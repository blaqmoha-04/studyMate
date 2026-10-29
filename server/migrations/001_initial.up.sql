-- StudyMate initial schema. All private tables reference users(id) ON DELETE CASCADE
-- so that deleting an account removes all of the user's data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  name                text NOT NULL,
  password_hash       text NOT NULL,
  theme               text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  timezone            text NOT NULL DEFAULT 'UTC',
  week_start          smallint NOT NULL DEFAULT 1 CHECK (week_start BETWEEN 0 AND 6),
  notify_deadlines    boolean NOT NULL DEFAULT true,
  notify_exams        boolean NOT NULL DEFAULT true,
  notify_study        boolean NOT NULL DEFAULT true,
  is_seed_user        boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  csrf_token    text NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);

CREATE TABLE assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description        text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  subject            text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 100),
  priority           text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status             text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','completed')),
  due_at             timestamptz NOT NULL,
  estimated_minutes  integer CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 10080),
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX assignments_user_due_idx ON assignments (user_id, due_at);
CREATE INDEX assignments_user_status_idx ON assignments (user_id, status);

CREATE TABLE class_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject      text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 100),
  lecturer     text NOT NULL DEFAULT '' CHECK (char_length(lecturer) <= 100),
  location     text NOT NULL DEFAULT '' CHECK (char_length(location) <= 100),
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  color        text NOT NULL DEFAULT '#2563eb' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX class_schedules_user_day_idx ON class_schedules (user_id, day_of_week, start_time);

CREATE TABLE study_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  subject     text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 100),
  content     text NOT NULL DEFAULT '' CHECK (char_length(content) <= 100000),
  tags        text[] NOT NULL DEFAULT '{}',
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_notes_user_idx ON study_notes (user_id, pinned DESC, updated_at DESC);
CREATE INDEX study_notes_tags_idx ON study_notes USING gin (tags);

CREATE TABLE exams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject     text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 100),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  exam_at     timestamptz NOT NULL,
  venue       text NOT NULL DEFAULT '' CHECK (char_length(venue) <= 200),
  notes       text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 5000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exams_user_date_idx ON exams (user_id, exam_at);

-- A study session is either planned (future block on the calendar) or a real,
-- server-timed focus session. Elapsed time is computed from server timestamps.
CREATE TABLE study_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id        uuid REFERENCES assignments(id) ON DELETE SET NULL,
  exam_id              uuid REFERENCES exams(id) ON DELETE SET NULL,
  subject              text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 100),
  notes                text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  status               text NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned','running','paused','completed','cancelled')),
  planned_start        timestamptz,
  planned_minutes      integer CHECK (planned_minutes IS NULL OR planned_minutes BETWEEN 1 AND 720),
  focus_minutes        integer NOT NULL DEFAULT 25 CHECK (focus_minutes BETWEEN 1 AND 240),
  break_minutes        integer NOT NULL DEFAULT 5 CHECK (break_minutes BETWEEN 1 AND 60),
  started_at           timestamptz,
  last_resumed_at      timestamptz,
  accumulated_seconds  integer NOT NULL DEFAULT 0 CHECK (accumulated_seconds >= 0),
  ended_at             timestamptz,
  actual_seconds       integer CHECK (actual_seconds IS NULL OR actual_seconds >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_sessions_user_status_idx ON study_sessions (user_id, status);
CREATE INDEX study_sessions_user_ended_idx ON study_sessions (user_id, ended_at);
CREATE INDEX study_sessions_user_planned_idx ON study_sessions (user_id, planned_start);
-- At most one running/paused timer per user.
CREATE UNIQUE INDEX study_sessions_one_active_idx ON study_sessions (user_id)
  WHERE status IN ('running','paused');

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('assignment_due','assignment_overdue','exam_upcoming','study_reminder')),
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  entity_type   text,
  entity_id     uuid,
  dedupe_key    text NOT NULL,
  read_at       timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, dismissed_at, created_at DESC);
