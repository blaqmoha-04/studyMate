import { h, mount, icon, clear } from '../dom.js';
import { get, post, del, qs } from '../api.js';
import { loading, errorState, emptyState, badge, pager, debounce, confirmDialog, toast, toastError, input } from '../ui.js';

export function dictionaryPage(container) {
  const st = { currentWord: null, currentEntry: null, vocabPage: 1, vocabQ: '' };
  const initialWord = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('word');
  const searchBox = h('div', {});
  const recentBox = h('div', {});
  const resultBox = h('div', {});
  const vocabBox = h('div', {});

  let currentAudio = null;
  function playAudio(url) {
    if (!url) return;
    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      currentAudio = new Audio(`/api/v1/dictionary/audio?url=${encodeURIComponent(url)}`);
      currentAudio.play().catch((err) => toastError(err, 'Could not play audio.'));
    } catch (err) {
      toastError(err, 'Could not play audio.');
    }
  }

  async function lookup(word) {
    const q = String(word ?? '').trim();
    if (!q) return;
    st.currentWord = q;
    mount(resultBox, loading());
    try {
      const res = await get(`/dictionary/lookup${qs({ word: q })}`);
      st.currentEntry = res.data;
      renderResult(res.data);
      loadRecent();
    } catch (err) {
      st.currentEntry = null;
      if (err?.status === 404) {
        mount(resultBox, emptyState(`No definition found for "${q}"`, 'Check your spelling or try searching for a different word.'));
      } else {
        mount(resultBox, errorState(err, () => lookup(q)));
      }
    }
  }

  async function loadDaily() {
    mount(resultBox, loading());
    try {
      const res = await get('/dictionary/daily');
      renderResult(res.data, { isDaily: true });
    } catch (err) {
      mount(resultBox, emptyState('Search for a word', 'Look up English definitions, pronunciations, and synonyms.'));
    }
  }

  async function toggleSave(entry) {
    if (!entry) return;
    if (entry.isSaved && entry.savedId) {
      try {
        await del(`/dictionary/vocabulary/${entry.savedId}`);
        entry.isSaved = false;
        entry.savedId = null;
        toast(`Removed "${entry.word}" from vocabulary.`);
        renderResult(entry);
        loadVocab();
      } catch (err) {
        toastError(err);
      }
    } else {
      try {
        const body = {
          word: entry.word,
          phonetic: entry.phonetic || '',
          partOfSpeech: entry.meanings?.[0]?.partOfSpeech || '',
          meanings: entry.meanings || [],
          audioUrl: entry.audioUrl || null,
        };
        const res = await post('/dictionary/vocabulary', body);
        entry.isSaved = true;
        entry.savedId = res.data.id;
        toast(`Saved "${entry.word}" to vocabulary!`, 'success');
        renderResult(entry);
        loadVocab();
      } catch (err) {
        toastError(err);
      }
    }
  }

  function renderResult(entry, { isDaily = false } = {}) {
    if (!entry) {
      mount(resultBox, emptyState('Search for a word', 'Look up English definitions, pronunciations, and synonyms.'));
      return;
    }

    const head = h('div', { class: 'dict-word-head' },
      h('div', {},
        h('div', { class: 'dict-word-title' },
          entry.word,
          isDaily ? badge('Word of the Day', 'primary') : null,
          entry.audioUrl ? h('button', {
            class: 'btn btn-ghost btn-sm btn-icon',
            type: 'button',
            'aria-label': `Listen to pronunciation of ${entry.word}`,
            onclick: () => playAudio(entry.audioUrl),
          }, icon('volume')) : null,
        ),
        entry.phonetic ? h('div', { class: 'dict-phonetic' }, entry.phonetic) : null,
      ),
      h('div', { class: 'actions' },
        h('button', {
          class: `btn btn-sm ${entry.isSaved ? 'btn-ghost' : 'btn-primary'}`,
          type: 'button',
          onclick: () => toggleSave(entry),
        }, icon('bookmark'), entry.isSaved ? 'Saved in Vocabulary' : 'Save Word'),
      ),
    );

    const meanings = (entry.meanings ?? []).map((m) => {
      const defs = (m.definitions ?? []).map((d) => h('li', {},
        h('div', {}, d.definition),
        d.example ? h('div', { class: 'dict-example' }, `\u201C${d.example}\u201D`) : null,
      ));

      const syns = (m.synonyms ?? []).slice(0, 8);
      const ants = (m.antonyms ?? []).slice(0, 8);

      return h('div', { class: 'dict-meaning-group' },
        m.partOfSpeech ? h('div', { class: 'dict-part' }, m.partOfSpeech) : null,
        defs.length ? h('ol', { class: 'dict-defs' }, ...defs) : null,
        syns.length ? h('div', { class: 'dict-synonyms' },
          h('strong', {}, 'Synonyms: '),
          ...syns.map((s) => h('button', { class: 'chip', type: 'button', onclick: () => { searchInput.value = s; lookup(s); } }, s)),
        ) : null,
        ants.length ? h('div', { class: 'dict-synonyms' },
          h('strong', {}, 'Antonyms: '),
          ...ants.map((a) => h('button', { class: 'chip', type: 'button', onclick: () => { searchInput.value = a; lookup(a); } }, a)),
        ) : null,
      );
    });

    mount(resultBox, h('div', { class: 'card' }, head, ...meanings));
  }

  async function loadRecent() {
    try {
      const res = await get('/dictionary/recent?limit=8');
      if (!res.data.length) {
        clear(recentBox);
        return;
      }
      mount(recentBox, h('div', { class: 'dict-chips' },
        h('span', { class: 'muted small' }, 'Recent:'),
        ...res.data.map((item) => h('button', {
          class: 'chip',
          type: 'button',
          onclick: () => { searchInput.value = item.word; lookup(item.word); },
        }, item.word)),
        h('button', {
          class: 'btn btn-ghost btn-sm dict-clear-btn',
          type: 'button',
          onclick: async () => {
            await del('/dictionary/recent');
            clear(recentBox);
          },
        }, 'Clear'),
      ));
    } catch {
      clear(recentBox);
    }
  }

  async function loadVocab() {
    mount(vocabBox, loading());
    try {
      const res = await get(`/dictionary/vocabulary${qs({ page: st.vocabPage, pageSize: 8, q: st.vocabQ })}`);
      const items = res.data ?? [];
      const meta = res.meta;
      if (!items.length) {
        mount(vocabBox, emptyState(
          st.vocabQ ? 'No matching words' : 'No saved vocabulary yet',
          st.vocabQ ? 'Try a different filter.' : 'Look up words and click "Save Word" to add them here.',
        ));
        return;
      }

      const list = h('ul', { class: 'list' },
        ...items.map((item) => h('li', {},
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, item.word),
            h('div', { class: 'muted small' }, [item.phonetic, item.partOfSpeech].filter(Boolean).join(' · ')),
          ),
          h('div', { class: 'actions' },
            item.audioUrl ? h('button', {
              class: 'btn btn-sm btn-ghost btn-icon',
              type: 'button',
              'aria-label': `Pronounce ${item.word}`,
              onclick: () => playAudio(item.audioUrl),
            }, icon('volume')) : null,
            h('button', {
              class: 'btn btn-sm btn-ghost',
              type: 'button',
              onclick: () => {
                searchInput.value = item.word;
                lookup(item.word);
              },
            }, 'View'),
            h('button', {
              class: 'btn btn-sm btn-ghost',
              type: 'button',
              'aria-label': `Remove ${item.word}`,
              onclick: async () => {
                if (!(await confirmDialog({
                  title: 'Remove word?',
                  message: `Remove "${item.word}" from your vocabulary?`,
                  confirmText: 'Remove',
                  danger: true,
                }))) return;
                try {
                  await del(`/dictionary/vocabulary/${item.id}`);
                  toast(`Removed "${item.word}"`);
                  if (st.currentEntry?.word?.toLowerCase() === item.word.toLowerCase()) {
                    st.currentEntry.isSaved = false;
                    st.currentEntry.savedId = null;
                    renderResult(st.currentEntry);
                  }
                  loadVocab();
                } catch (e) {
                  toastError(e);
                }
              },
            }, icon('trash')),
          ),
        )),
      );

      mount(vocabBox, list, pager(meta, (p) => { st.vocabPage = p; loadVocab(); }));
    } catch (err) {
      mount(vocabBox, errorState(err, loadVocab));
    }
  }

  // Search input & form
  const searchInput = input({
    type: 'search',
    class: 'input',
    placeholder: 'Look up an English word, e.g. resilient...',
    'aria-label': 'Word search',
  });
  const searchForm = h('form', { class: 'dict-search-bar', novalidate: true },
    searchInput,
    h('button', { class: 'btn btn-primary', type: 'submit' }, icon('search'), 'Search'),
  );
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    lookup(searchInput.value);
  });
  mount(searchBox, searchForm);

  // Vocabulary filter input
  const vocabFilter = input({
    type: 'search',
    class: 'input',
    placeholder: 'Filter saved words…',
    'aria-label': 'Filter saved vocabulary',
  });
  vocabFilter.addEventListener('input', debounce(() => {
    st.vocabQ = vocabFilter.value.trim();
    st.vocabPage = 1;
    loadVocab();
  }, 300));

  const savedCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', {}, 'Saved Vocabulary'),
    ),
    h('div', { class: 'dict-filter-box' }, vocabFilter),
    vocabBox,
  );

  mount(container,
    h('div', { class: 'page-head' },
      h('div', {},
        h('h2', {}, 'Dictionary & Vocabulary'),
        h('p', { class: 'muted' }, 'Search English definitions, hear pronunciations, and save words to study.'),
      ),
    ),
    searchBox,
    recentBox,
    h('div', { class: 'grid grid-2' },
      resultBox,
      savedCard,
    ),
  );

  loadRecent();
  if (initialWord) {
    searchInput.value = initialWord;
    lookup(initialWord);
  } else {
    loadDaily();
  }
  loadVocab();

  return () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  };
}
