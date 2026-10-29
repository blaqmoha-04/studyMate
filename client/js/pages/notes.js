import { h, mount, icon } from '../dom.js';
import { get, post, patch, del, qs, ApiError } from '../api.js';
import { setLeaveGuard, navigate, parseHash } from '../router.js';
import { loading, errorState, emptyState, badge, pager, debounce, confirmDialog, toast, toastError, input, select, textarea, field } from '../ui.js';
import { fmtDateTime, fmtTime } from '../time.js';
import { quickCreateNote } from '../forms.js';

// User text is only ever placed into .value / text nodes (never markup), so notes cannot inject HTML or scripts.
export function notesPage(container) {
  const st = { page: 1, q: '', subject: '', tag: '', pinned: false, id: parseHash().query.id ?? null };
  const listBox = h('div', {}); const editorBox = h('div', {});
  let note = null; let dirty = false; let saving = false; let pending = false; let saveTimer = null; let statusEl = null; let conflict = null;

  const onBeforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBeforeUnload);
  setLeaveGuard(() => !dirty || window.confirm('You have unsaved changes to this note. Leave without saving?'));

  const setStatus = (text, error = false) => { if (statusEl) { statusEl.textContent = text; statusEl.className = `save-status ${error ? 'error' : ''}`; } };

  async function flush() { clearTimeout(saveTimer); if (dirty) await save(); }

  async function save(overrideBase) {
    if (!note || conflict) return;
    if (saving) { pending = true; return; }
    saving = true; setStatus('Saving…');
    const body = collect(); body.baseUpdatedAt = overrideBase ?? note.updatedAt;
    try {
      const res = await patch(`/notes/${note.id}`, body);
      note = { ...note, ...res.data }; dirty = false; setStatus(`Saved at ${fmtTime(new Date().toISOString())}`);
      loadList(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.current) { showConflict(err.details.current); }
      else { setStatus('Could not save — will retry on your next change', true); toastError(err); }
    } finally { saving = false; if (pending) { pending = false; if (dirty && !conflict) save(); } }
  }
  const schedule = debounce(() => save(), 1500);
  function touch() { dirty = true; setStatus('Unsaved changes…'); schedule(); }

  let titleEl; let subjectEl; let tagsEl; let contentEl; let pinBtn;
  const collect = () => ({ title: titleEl.value.trim() || 'Untitled note', subject: subjectEl.value.trim(),
    tags: tagsEl.value.split(',').map((t) => t.trim()).filter(Boolean), content: contentEl.value, pinned: note.pinned });

  function showConflict(current) {
    conflict = current; setStatus('This note was changed somewhere else', true);
    const banner = h('div', { class: 'form-error', role: 'alert' }, 'This note was saved from another tab or device after you opened it. ',
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { conflict = null; note = current; dirty = false; renderEditor(); } }, 'Load the latest version'), ' ',
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { conflict = null; banner.remove(); note = { ...note, updatedAt: current.updatedAt }; save(current.updatedAt); } }, 'Keep my version'));
    editorBox.prepend(banner);
  }

  function renderEditor() {
    if (!note) { mount(editorBox, h('div', { class: 'card' }, emptyState('Select a note', 'Choose a note on the left or create a new one.'))); return; }
    titleEl = input({ type: 'text', class: 'input editor-title', maxlength: 200, value: note.title, 'aria-label': 'Note title' });
    subjectEl = input({ type: 'text', maxlength: 100, value: note.subject, placeholder: 'e.g. Biology' });
    tagsEl = input({ type: 'text', value: note.tags.join(', '), placeholder: 'exam, chapter-3' });
    contentEl = textarea({ class: 'input editor-body', maxlength: 100000, rows: 16, 'aria-label': 'Note content' }); contentEl.value = note.content;
    statusEl = h('span', { class: 'save-status', role: 'status' }, `Saved · last edited ${fmtDateTime(note.updatedAt)}`);
    pinBtn = h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': String(note.pinned), onclick: () => { note.pinned = !note.pinned; pinBtn.setAttribute('aria-pressed', String(note.pinned)); pinBtn.lastChild.textContent = note.pinned ? 'Pinned' : 'Pin'; touch(); } }, icon('pin'), note.pinned ? 'Pinned' : 'Pin');
    for (const el of [titleEl, subjectEl, tagsEl, contentEl]) el.addEventListener('input', touch);
    mount(editorBox, h('div', { class: 'card' },
      h('div', { class: 'card-head' }, statusEl, h('div', { class: 'actions' }, pinBtn,
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: removeNote }, icon('trash'), 'Delete'))),
      h('div', { class: 'field' }, titleEl), h('div', { class: 'row' }, field('Subject', subjectEl), field('Tags', tagsEl, { hint: 'Comma-separated' })), field('Content', contentEl)));
  }

  async function removeNote() {
    if (!(await confirmDialog({ title: 'Delete note?', message: `\u201C${note.title}\u201D will be permanently deleted.`, confirmText: 'Delete', danger: true }))) return;
    try { clearTimeout(saveTimer); dirty = false; await del(`/notes/${note.id}`); toast('Note deleted'); note = null; st.id = null; navigate('/notes'); renderEditor(); loadList(); } catch (e) { toastError(e); }
  }

  async function open(id) {
    try { await flush(); } catch { /* ignore */ }
    if (conflict) { conflict = null; }
    st.id = id; history.replaceState(null, '', `#/notes?id=${id}`);
    mount(editorBox, loading());
    try { note = (await get(`/notes/${id}`)).data; renderEditor(); loadList(true); }
    catch (err) { note = null; mount(editorBox, errorState(err)); }
  }

  const search = input({ type: 'search', placeholder: 'Search notes…', 'aria-label': 'Search notes' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.page = 1; loadList(); }));
  const subjectSel = select([['', 'All subjects']], '', { 'aria-label': 'Filter by subject' }); subjectSel.addEventListener('change', () => { st.subject = subjectSel.value; st.page = 1; loadList(); });
  const tagSel = select([['', 'All tags']], '', { 'aria-label': 'Filter by tag' }); tagSel.addEventListener('change', () => { st.tag = tagSel.value; st.page = 1; loadList(); });
  const pinFilter = h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': 'false', onclick: () => { st.pinned = !st.pinned; pinFilter.setAttribute('aria-pressed', String(st.pinned)); pinFilter.classList.toggle('btn-primary', st.pinned); st.page = 1; loadList(); } }, icon('pin'), 'Pinned only');

  async function loadFilters() {
    try {
      const { data } = await get('/notes/meta');
      const fill = (el, items, first, cur) => { el.replaceChildren(h('option', { value: '' }, first), ...items.map(([v, l]) => h('option', { value: v, selected: v === cur }, l))); };
      fill(subjectSel, data.subjects.map((s) => [s, s]), 'All subjects', st.subject); fill(tagSel, data.tags.map((t) => [t.tag, `${t.tag} (${t.count})`]), 'All tags', st.tag);
    } catch { /* filters are optional */ }
  }

  async function loadList(quiet = false) {
    if (!quiet) mount(listBox, loading());
    try {
      const res = await get(`/notes${qs({ page: st.page, pageSize: 20, q: st.q, subject: st.subject, tag: st.tag, pinned: st.pinned ? 'true' : '' })}`);
      if (!res.data.length) { mount(listBox, emptyState(st.q || st.subject || st.tag || st.pinned ? 'No matching notes' : 'No notes yet', st.q ? 'Try a different search.' : 'Create your first note.')); return; }
      mount(listBox, ...res.data.map((n) => h('button', { class: 'note-item', type: 'button', 'aria-current': String(n.id === st.id), onclick: () => open(n.id) },
        h('div', { class: 't' }, n.pinned ? '📌 ' : '', n.id === st.id && note ? note.title : n.title), n.subject ? badge(n.subject, 'primary') : null,
        n.preview ? h('div', { class: 'p' }, n.preview) : null, h('div', { class: 'muted small' }, fmtDateTime(n.updatedAt)))), pager(res.meta, (p) => { st.page = p; loadList(); }));
      loadFilters();
    } catch (err) { if (!quiet) mount(listBox, errorState(err, loadList)); }
  }

  async function create() { try { await flush(); const n = await quickCreateNote(); await loadList(); await open(n.id); titleEl?.select(); } catch (e) { toastError(e); } }

  mount(container, h('div', { class: 'page-head' }, h('h2', {}, 'Notes'), h('button', { class: 'btn btn-primary', type: 'button', onclick: create }, icon('plus'), 'New note')),
    h('div', { class: 'notes-layout' }, h('div', {}, h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, search), subjectSel, tagSel, pinFilter), listBox), editorBox));
  renderEditor(); loadList(); if (st.id) open(st.id);

  return () => { clearTimeout(saveTimer); window.removeEventListener('beforeunload', onBeforeUnload); setLeaveGuard(null); if (dirty && note && !conflict) save(); };
}
