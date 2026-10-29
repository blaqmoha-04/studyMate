ALTER TABLE users DROP COLUMN IF EXISTS learning_goal;
ALTER TABLE users DROP COLUMN IF EXISTS terms_version;
ALTER TABLE users DROP COLUMN IF EXISTS terms_accepted_at;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
