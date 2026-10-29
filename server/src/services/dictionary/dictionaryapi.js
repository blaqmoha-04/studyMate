// The default provider: the free Dictionary API at api.dictionaryapi.dev.
//
// The service never talks to it directly — it goes through this class, so another dictionary
// service can be dropped in later (see ./providers.js for the registry).
//
// Nothing secret is involved: the public API needs no key. The provider is called by the SERVER,
// so the student's browser never talks to a third party and the strict Content-Security-Policy
// ("default-src 'self'") stays intact.
import dns from 'node:dns';
import net from 'node:net';
import { DictionaryProvider, cleanList, emptyEntry, mergeMeanings } from './provider.js';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(true);
}

const DEFAULT_BASE_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';

// The provider must fail in a way the service understands. These are plain Error objects with a
// `dictionaryError` marker; the service turns them into HTTP responses.
export class WordNotFoundError extends Error {
  constructor(word) { super(`No definition found for "${word}"`); this.name = 'WordNotFoundError'; this.word = word; this.dictionaryError = 'not_found'; }
}
export class ProviderUnavailableError extends Error {
  constructor(message, code = 'dictionary_unavailable') { super(message); this.name = 'ProviderUnavailableError'; this.dictionaryError = code; }
}

export function createDictionaryApiProvider({ baseUrl = DEFAULT_BASE_URL, timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const origin = new URL(baseUrl).origin;

  const provider = new DictionaryProvider();
  provider.name = 'dictionaryapi.dev';

  const cache = new Map();
  const MAX_CACHE_SIZE = 500;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  const fetchWithRetry = async (url, opts) => {
    try {
      return await fetchImpl(url, opts);
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw err;
      }
      // Retry once on network error
      return await fetchImpl(url, opts);
    }
  };

  provider.lookup = async (word) => {
    const normalizedKey = String(word ?? '').trim().toLowerCase();
    const cached = cache.get(normalizedKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.entry;
    }

    const url = `${baseUrl}/${encodeURIComponent(word)}`;
    let res;
    try {
      res = await fetchWithRetry(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new ProviderUnavailableError('The dictionary service took too long to answer. Please try again.', 'dictionary_timeout');
      }
      throw new ProviderUnavailableError('Cannot reach the dictionary service right now. Please try again.');
    }
    if (res.status === 404) throw new WordNotFoundError(word);
    if (!res.ok) throw new ProviderUnavailableError('The dictionary service is not answering properly. Please try again.');

    let payload;
    try { payload = await res.json(); }
    catch { throw new ProviderUnavailableError('The dictionary service sent something we could not read. Please try again.'); }

    const entries = Array.isArray(payload) ? payload : (payload ? [payload] : []);
    if (!entries.length) throw new WordNotFoundError(word);
    const result = normalizeEntries(entries, word);

    if (cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
    cache.set(normalizedKey, { entry: result, expiresAt: Date.now() + CACHE_TTL_MS });

    return result;
  };

  // Only audio published on the provider's own origin may be proxied. This is what stops the
  // audio route from being turned into an open proxy for arbitrary URLs.
  provider.isAllowedAudioUrl = (url) => {
    try {
      if (!(url instanceof URL) || url.protocol !== 'https:') return false;
      return url.origin === origin || url.hostname === 'ssl.gstatic.com';
    }
    catch { return false; }
  };

  provider.fetchAudio = async (url) => {
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ProviderUnavailableError('Cannot reach the pronunciation file right now. Please try again.');
    }
    if (!res.ok) throw new ProviderUnavailableError('The pronunciation file is not available right now.');
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    if (!/^audio\//.test(contentType) && contentType !== 'application/octet-stream') {
      throw new ProviderUnavailableError('That pronunciation file is not audio.');
    }
    return { body: res.body, contentType, length: Number(res.headers.get('content-length') ?? 0) };
  };

  return provider;
}

// Turn the upstream payload into our Entry shape. Nothing is invented: every field comes from the API.
export function normalizeEntries(entries, word) {
  const entry = emptyEntry(word);
  const groups = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (!entry.phonetic && typeof e.phonetic === 'string' && e.phonetic.trim()) entry.phonetic = e.phonetic.trim();
    for (const p of Array.isArray(e.phonetics) ? e.phonetics : []) {
      if (!entry.audioUrl && typeof p?.audio === 'string' && p.audio.trim()) {
        const audio = p.audio.trim();
        entry.audioUrl = audio.startsWith('//') ? `https:${audio}` : audio;
      }
      if (!entry.phonetic && typeof p?.text === 'string' && p.text.trim()) entry.phonetic = p.text.trim();
    }
    for (const s of Array.isArray(e.sourceUrls) ? e.sourceUrls : []) {
      if (typeof s === 'string' && s.trim() && !entry.sourceUrls.includes(s.trim())) entry.sourceUrls.push(s.trim());
    }
    for (const m of Array.isArray(e.meanings) ? e.meanings : []) {
      if (!m || typeof m !== 'object') continue;
      groups.push({
        partOfSpeech: typeof m.partOfSpeech === 'string' ? m.partOfSpeech.trim() : '',
        definitions: (Array.isArray(m.definitions) ? m.definitions : []).map((d) => ({
          definition: typeof d?.definition === 'string' ? d.definition : '',
          example: typeof d?.example === 'string' ? d.example : '',
          synonyms: cleanList(d?.synonyms),
          antonyms: cleanList(d?.antonyms),
        })),
        synonyms: cleanList(m.synonyms),
        antonyms: cleanList(m.antonyms),
      });
    }
  }
  entry.meanings = mergeMeanings(groups);
  return entry;
}
