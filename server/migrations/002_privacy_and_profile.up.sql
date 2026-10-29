-- Data minimisation: the user agent string was stored per session but nothing used it. Remove it.
ALTER TABLE sessions DROP COLUMN user_agent;
-- Recorded consent: when the user accepted the Terms/Privacy Policy and which version.
ALTER TABLE users ADD COLUMN terms_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN terms_version text;
-- Optional, user-written profile field (shown only to that user).
ALTER TABLE users ADD COLUMN learning_goal text NOT NULL DEFAULT '' CHECK (char_length(learning_goal) <= 500);
