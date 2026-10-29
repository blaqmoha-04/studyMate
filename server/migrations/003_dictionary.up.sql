-- Dictionary feature: saved vocabulary, recent searches and the pool the Word of the Day is drawn from.
-- All user-owned tables reference users(id) ON DELETE CASCADE, so deleting an account removes them.
CREATE TABLE vocabulary (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word             text NOT NULL CHECK (char_length(word) BETWEEN 1 AND 100),
  normalized_word  text NOT NULL CHECK (char_length(normalized_word) BETWEEN 1 AND 100),
  phonetic         text NOT NULL DEFAULT '',
  part_of_speech   text NOT NULL DEFAULT '',
  -- The definitions, examples, synonyms and antonyms exactly as the dictionary provider returned them.
  meanings         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The provider's audio URL. It is never shown to the browser directly: the server proxies it.
  audio_url        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, normalized_word)
);
CREATE INDEX vocabulary_user_idx ON vocabulary (user_id, updated_at DESC);

CREATE TABLE dictionary_searches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word             text NOT NULL CHECK (char_length(word) BETWEEN 1 AND 100),
  normalized_word  text NOT NULL CHECK (char_length(normalized_word) BETWEEN 1 AND 100),
  searched_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, normalized_word)
);
CREATE INDEX dictionary_searches_user_idx ON dictionary_searches (user_id, searched_at DESC);

-- Candidate words for the Word of the Day. Only the WORDS live here: the definition is always looked up
-- live through the dictionary provider, exactly like a student's own search. The operator may add more rows.
CREATE TABLE dictionary_daily_words (
  word       text PRIMARY KEY,
  position   integer NOT NULL UNIQUE
);
INSERT INTO dictionary_daily_words (word, position) VALUES
  ('abandon', 1), ('ability', 2), ('achieve', 3), ('acquire', 4), ('adapt', 5), ('adequate', 6),
  ('adjust', 7), ('admire', 8), ('advice', 9), ('analyse', 10), ('ancestor', 11), ('announce', 12),
  ('anxious', 13), ('apparent', 14), ('approach', 15), ('appropriate', 16), ('argue', 17), ('arrange', 18),
  ('assess', 19), ('assume', 20), ('attach', 21), ('attempt', 22), ('attend', 23), ('attitude', 24),
  ('author', 25), ('available', 26), ('average', 27), ('avoid', 28), ('aware', 29), ('balance', 30),
  ('barrier', 31), ('benefit', 32), ('boundary', 33), ('capable', 34), ('capacity', 35), ('circumstance', 36),
  ('colleague', 37), ('combine', 38), ('commit', 39), ('communicate', 40), ('community', 41), ('compare', 42),
  ('complex', 43), ('concentrate', 44), ('concept', 45), ('conclude', 46), ('conduct', 47), ('confident', 48),
  ('conflict', 49), ('consequence', 50), ('consider', 51), ('constant', 52), ('contain', 53), ('contribute', 54),
  ('convention', 55), ('convince', 56), ('cooperate', 57), ('crucial', 58), ('curious', 59), ('decline', 60),
  ('define', 61), ('demonstrate', 62), ('depend', 63), ('derive', 64), ('describe', 65), ('determine', 66),
  ('develop', 67), ('difference', 68), ('difficult', 69), ('dimension', 70), ('discuss', 71), ('distinguish', 72),
  ('distribute', 73), ('economy', 74), ('effective', 75), ('efficient', 76), ('emphasise', 77), ('encourage', 78),
  ('enormous', 79), ('environment', 80), ('establish', 81), ('estimate', 82), ('evaluate', 83), ('evidence', 84),
  ('examine', 85), ('exceed', 86), ('exchange', 87), ('exist', 88), ('expand', 89), ('experience', 90),
  ('explain', 91), ('explore', 92), ('express', 93), ('factor', 94), ('familiar', 95), ('feature', 96),
  ('focus', 97), ('function', 98), ('generate', 99), ('identify', 100), ('impact', 101), ('important', 102),
  ('improve', 103), ('include', 104), ('increase', 105), ('indicate', 106), ('individual', 107), ('influence', 108),
  ('involve', 109), ('issue', 110), ('knowledge', 111), ('maintain', 112), ('major', 113), ('measure', 114),
  ('method', 115), ('obtain', 116), ('occur', 117), ('opportunity', 118), ('participate', 119), ('particular', 120),
  ('perform', 121), ('period', 122), ('potential', 123), ('principle', 124), ('priority', 125), ('process', 126),
  ('produce', 127), ('professional', 128), ('provide', 129), ('publish', 130), ('purpose', 131), ('quality', 132),
  ('recognise', 133), ('recommend', 134), ('reduce', 135), ('reflect', 136), ('relevant', 137), ('require', 138),
  ('research', 139), ('resource', 140), ('respond', 141), ('reveal', 142), ('significant', 143), ('similar', 144),
  ('situation', 145), ('specific', 146), ('strategy', 147), ('structure', 148), ('success', 149), ('suggest', 150),
  ('support', 151), ('theory', 152), ('various', 153);
