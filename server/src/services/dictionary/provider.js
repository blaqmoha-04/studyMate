// The dictionary provider contract.
//
// Everything above this file (service, routes, client) is provider-agnostic: to use a different
// dictionary service, write a provider that satisfies this contract and register it in `providers.js`.
// Nothing else in the application has to change.
//
// A provider must:
//   name              -> string   a short identifier shown to the user ("dictionaryapi.dev")
//   lookup(word)      -> Promise<Entry>   an Entry is { word, phonetic, audioUrl, sourceUrls, meanings }
//   isAllowedAudioUrl(url) -> boolean        which audio URLs this provider is willing to serve
//   fetchAudio(url)   -> Promise<{ body, contentType, length }>   stream a pronunciation file
//
// An Entry's `meanings` is a list of meaning groups:
//   { partOfSpeech, definitions: [{ definition, example, synonyms[], antonyms[] }], synonyms[], antonyms[] }

// The shape of an entry with nothing filled in. Providers build on this so the client always
// receives the same keys, even for a sparse word.
export function emptyEntry(word) {
  return { word, phonetic: '', audioUrl: null, sourceUrls: [], meanings: [] };
}

// Lower-cased, whitespace-collapsed word. Used for de-duplicating saved words and searches.
export const normalizeWord = (word) => String(word ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// Trim a provider's free-text list down to a clean array of short strings.
export function cleanList(values, { max = 40, length = 60 } = {}) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s || s.length > length) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// Merge the meaning groups of several provider entries, keeping the first part of speech of each
// group and combining everything else. The upstream API returns one entry per word form, and the
// same part of speech can appear in more than one of them.
export function mergeMeanings(groups) {
  const byPart = new Map();
  for (const g of groups) {
    const part = (g?.partOfSpeech ?? '').trim();
    const key = part.toLowerCase();
    if (!byPart.has(key)) byPart.set(key, { partOfSpeech: part, definitions: [], synonyms: [], antonyms: [] });
    const target = byPart.get(key);
    for (const d of g?.definitions ?? []) {
      const definition = typeof d?.definition === 'string' ? d.definition.trim() : '';
      if (!definition) continue;
      target.definitions.push({
        definition,
        example: typeof d.example === 'string' ? d.example.trim() : '',
        synonyms: cleanList(d.synonyms),
        antonyms: cleanList(d.antonyms),
      });
    }
    target.synonyms.push(...cleanList(g?.synonyms));
    target.antonyms.push(...cleanList(g?.antonyms));
  }
  for (const group of byPart.values()) {
    group.synonyms = [...new Set(group.synonyms)];
    group.antonyms = [...new Set(group.antonyms)];
  }
  return [...byPart.values()];
}

// The base class. A provider only has to implement lookup() and (if it has audio) the two audio methods.
export class DictionaryProvider {
  constructor(name = 'unknown') { this.name = name; }
  async lookup() { throw new Error('lookup() is not implemented by this provider'); }
  isAllowedAudioUrl() { return false; }
  async fetchAudio() { throw new Error('fetchAudio() is not implemented by this provider'); }
}
