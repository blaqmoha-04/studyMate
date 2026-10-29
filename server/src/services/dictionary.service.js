import { createProvider } from './dictionary/providers.js';
import { normalizeWord } from './dictionary/provider.js';
import { WordNotFoundError, ProviderUnavailableError } from './dictionary/dictionaryapi.js';
import { whereBuilder, pageMeta, toDto, likePattern } from '../utils/sql.js';
import { AppError, badRequest, notFound } from '../utils/errors.js';

export function createDictionaryService({ db, config }) {
  const provider = createProvider(config);
  const dto = (r) => toDto(r);

  function wrapProviderError(err, word) {
    if (err instanceof WordNotFoundError || err?.dictionaryError === 'not_found') {
      return notFound(`Word "${word}"`);
    }
    if (err instanceof ProviderUnavailableError || err?.dictionaryError) {
      return new AppError(503, err.dictionaryError || 'dictionary_unavailable', err.message);
    }
    return err;
  }

  async function lookup(userId, rawWord) {
    const word = String(rawWord ?? '').trim();
    if (!word) throw badRequest('Word is required');
    const normalized = normalizeWord(word);

    // Record the search history
    await db.query(
      `INSERT INTO dictionary_searches (user_id, word, normalized_word, searched_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, normalized_word) DO UPDATE SET word = EXCLUDED.word, searched_at = now()`,
      [userId, word, normalized],
    );

    let entry;
    try {
      entry = await provider.lookup(word);
    } catch (err) {
      throw wrapProviderError(err, word);
    }

    // Check if word is saved in user's vocabulary
    const { rows } = await db.query(
      `SELECT id, created_at, updated_at FROM vocabulary WHERE user_id = $1 AND normalized_word = $2`,
      [userId, normalized],
    );

    return {
      ...entry,
      isSaved: Boolean(rows[0]),
      savedId: rows[0]?.id ?? null,
    };
  }

  async function getDailyWord() {
    const countRes = await db.query('SELECT count(*)::int AS total FROM dictionary_daily_words');
    const total = countRes.rows[0]?.total ?? 0;
    if (!total) throw notFound('Daily word');

    // Deterministic day index
    const dayIndex = Math.floor(Date.now() / 86400000);
    const startPos = (dayIndex % total) + 1;

    let lastErr;
    for (let offset = 0; offset < Math.min(5, total); offset++) {
      const position = ((startPos - 1 + offset) % total) + 1;
      const { rows } = await db.query('SELECT word FROM dictionary_daily_words WHERE position = $1', [position]);
      const word = rows[0]?.word;
      if (!word) continue;

      try {
        return await provider.lookup(word);
      } catch (err) {
        lastErr = err;
        if (err instanceof WordNotFoundError || err?.dictionaryError === 'not_found') {
          continue;
        }
        throw wrapProviderError(err, word);
      }
    }
    throw wrapProviderError(lastErr || notFound('Daily word'), 'daily word');
  }

  async function fetchAudio(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw badRequest('Invalid audio URL');
    }

    if (!provider.isAllowedAudioUrl(parsed)) {
      throw badRequest('Disallowed audio URL');
    }

    try {
      return await provider.fetchAudio(parsed.href);
    } catch (err) {
      throw wrapProviderError(err);
    }
  }

  async function listVocabulary(userId, f = {}) {
    const w = whereBuilder(userId);
    if (f.q) {
      w.add(`(word ILIKE ? ESCAPE '\\' OR part_of_speech ILIKE ? ESCAPE '\\')`, likePattern(f.q));
    }
    const page = f.page ?? 1;
    const pageSize = f.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    const [rows, count] = await Promise.all([
      db.query(
        `SELECT id, user_id, word, normalized_word, phonetic, part_of_speech, meanings, audio_url, created_at, updated_at
           FROM vocabulary WHERE ${w.clause()}
          ORDER BY updated_at DESC, id LIMIT ${pageSize} OFFSET ${offset}`,
        w.vals,
      ),
      db.query(`SELECT count(*)::int AS n FROM vocabulary WHERE ${w.clause()}`, w.vals),
    ]);

    return {
      items: rows.rows.map(dto),
      meta: pageMeta(page, pageSize, count.rows[0].n),
    };
  }

  async function getVocabulary(userId, id) {
    const { rows } = await db.query(
      `SELECT * FROM vocabulary WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (!rows[0]) throw notFound('Vocabulary entry');
    return dto(rows[0]);
  }

  async function saveVocabulary(userId, b) {
    const word = String(b.word ?? '').trim();
    if (!word) throw badRequest('Word is required');
    const normalized = normalizeWord(word);
    const phonetic = String(b.phonetic ?? '').trim();
    const partOfSpeech = String(b.partOfSpeech ?? '').trim();
    const meanings = Array.isArray(b.meanings) ? JSON.stringify(b.meanings) : '[]';
    const audioUrl = b.audioUrl ? String(b.audioUrl).trim() : null;

    const { rows } = await db.query(
      `INSERT INTO vocabulary (user_id, word, normalized_word, phonetic, part_of_speech, meanings, audio_url)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (user_id, normalized_word) DO UPDATE SET
         word = EXCLUDED.word,
         phonetic = EXCLUDED.phonetic,
         part_of_speech = EXCLUDED.part_of_speech,
         meanings = EXCLUDED.meanings,
         audio_url = EXCLUDED.audio_url,
         updated_at = now()
       RETURNING *`,
      [userId, word, normalized, phonetic, partOfSpeech, meanings, audioUrl],
    );
    return dto(rows[0]);
  }

  async function removeVocabulary(userId, id) {
    const r = await db.query('DELETE FROM vocabulary WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!r.rowCount) throw notFound('Vocabulary entry');
  }

  async function recentSearches(userId, limit = 10) {
    const clampedLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    const { rows } = await db.query(
      `SELECT id, word, searched_at FROM dictionary_searches
        WHERE user_id = $1 ORDER BY searched_at DESC LIMIT $2`,
      [userId, clampedLimit],
    );
    return rows.map(dto);
  }

  async function clearRecentSearches(userId) {
    await db.query('DELETE FROM dictionary_searches WHERE user_id = $1', [userId]);
  }

  return {
    lookup,
    getDailyWord,
    fetchAudio,
    listVocabulary,
    getVocabulary,
    saveVocabulary,
    removeVocabulary,
    recentSearches,
    clearRecentSearches,
  };
}
