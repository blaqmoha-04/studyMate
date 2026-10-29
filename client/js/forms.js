// Create/edit dialogs shared by several pages and the dashboard quick actions.
import { h, openModal, field, input, textarea, select, clearErrors, showErrors, setBusy, toast } from './ui.js';
import { ApiError, get, post, patch } from './api.js';
import { inputToIso, isoToInput, defaultInput, DAYS } from './time.js';

const fieldError = (name, message) => new ApiError(400, { error: { details: [{ field: name, message }] } });

// Generic form dialog: build(fields) -> {payload()} ; submit(payload) -> result
function formDialog({ title, submitText, build, submit, onDone, extra }) {
  const form = h('form', { novalidate: true });
  const getPayload = build(form);
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, submitText);
  let modal;
  form.append(extra ?? null, h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Cancel'), btn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); clearErrors(form);
    let payload;
    try { payload = getPayload(); } catch (err) { showErrors(form, err); return; }
    setBusy(btn, true);
    try { const res = await submit(payload); modal.close(); onDone?.(res); }
    catch (err) { showErrors(form, err); }
    finally { setBusy(btn, false); }
  });
  modal = openModal({ title, body: form });
  form.querySelector('input, textarea, select')?.focus();
  return modal;
}

const num = (v) => (v === '' || v == null ? null : Number(v));

export function openAssignmentForm({ item, onSaved } = {}) {
  return formDialog({
    title: item ? 'Edit assignment' : 'New assignment', submitText: item ? 'Save changes' : 'Add assignment',
    build(form) {
      const title = input({ type: 'text', maxlength: 200, value: item?.title ?? '', autocomplete: 'off' });
      const subject = input({ type: 'text', maxlength: 100, value: item?.subject ?? '', autocomplete: 'off' });
      const due = input({ type: 'datetime-local', value: item ? isoToInput(item.dueAt) : defaultInput(24) });
      const priority = select([['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']], item?.priority ?? 'medium');
      const status = select([['todo', 'To do'], ['in_progress', 'In progress'], ['completed', 'Completed']], item?.status ?? 'todo');
      const est = input({ type: 'number', min: 1, max: 10080, step: 5, value: item?.estimatedMinutes ?? '', inputmode: 'numeric' });
      const desc = textarea({ maxlength: 5000 }); desc.value = item?.description ?? '';
      form.append(field('Title', title, { name: 'title' }), field('Subject', subject, { name: 'subject' }),
        h('div', { class: 'row' }, field('Due', due, { name: 'dueAt' }), field('Estimated minutes', est, { name: 'estimatedMinutes', hint: 'Optional' })),
        h('div', { class: 'row' }, field('Priority', priority, { name: 'priority' }), field('Status', status, { name: 'status' })),
        field('Description', desc, { name: 'description' }));
      return () => {
        const dueAt = inputToIso(due.value);
        if (!dueAt) throw fieldError('dueAt', 'Choose a valid due date and time');
        return { title: title.value, subject: subject.value, dueAt, priority: priority.value, status: status.value,
          estimatedMinutes: num(est.value), description: desc.value };
      };
    },
    submit: (p) => (item ? patch(`/assignments/${item.id}`, p) : post('/assignments', p)),
    onDone: (res) => { toast(item ? 'Assignment updated' : 'Assignment added'); onSaved?.(res.data); },
  });
}

export function openClassForm({ item, onSaved, defaultDay = 1 } = {}) {
  return formDialog({
    title: item ? 'Edit class' : 'New class', submitText: item ? 'Save changes' : 'Add class',
    build(form) {
      const subject = input({ type: 'text', maxlength: 100, value: item?.subject ?? '' });
      const lecturer = input({ type: 'text', maxlength: 100, value: item?.lecturer ?? '' });
      const location = input({ type: 'text', maxlength: 100, value: item?.location ?? '' });
      const day = select(DAYS.map((d, i) => [i, d]), item?.dayOfWeek ?? defaultDay);
      const start = input({ type: 'time', value: item?.startTime ?? '09:00' });
      const end = input({ type: 'time', value: item?.endTime ?? '10:00' });
      const color = input({ type: 'color', value: item?.color ?? '#2563eb' });
      form.append(field('Subject / course', subject, { name: 'subject' }),
        h('div', { class: 'row' }, field('Lecturer', lecturer, { name: 'lecturer' }), field('Room / location', location, { name: 'location' })),
        field('Day', day, { name: 'dayOfWeek' }),
        h('div', { class: 'row' }, field('Starts', start, { name: 'startTime' }), field('Ends', end, { name: 'endTime' })),
        field('Colour label', color, { name: 'color' }));
      return () => ({ subject: subject.value, lecturer: lecturer.value, location: location.value, dayOfWeek: Number(day.value),
        startTime: start.value, endTime: end.value, color: color.value });
    },
    submit: (p) => (item ? patch(`/classes/${item.id}`, p) : post('/classes', p)),
    onDone: (res) => {
      const w = res.meta?.warnings ?? [];
      if (w.length) toast(`Saved, but this overlaps with ${w.map((c) => `${c.subject} (${c.startTime}–${c.endTime})`).join(', ')}`, 'warning', 9000);
      else toast(item ? 'Class updated' : 'Class added');
      onSaved?.(res.data);
    },
  });
}

export function openExamForm({ item, onSaved } = {}) {
  return formDialog({
    title: item ? 'Edit examination' : 'New examination', submitText: item ? 'Save changes' : 'Add exam',
    build(form) {
      const subject = input({ type: 'text', maxlength: 100, value: item?.subject ?? '' });
      const title = input({ type: 'text', maxlength: 200, value: item?.title ?? '', placeholder: 'e.g. Final exam' });
      const at = input({ type: 'datetime-local', value: item ? isoToInput(item.examAt) : defaultInput(24 * 14) });
      const venue = input({ type: 'text', maxlength: 200, value: item?.venue ?? '' });
      const notes = textarea({ maxlength: 5000 }); notes.value = item?.notes ?? '';
      form.append(field('Subject', subject, { name: 'subject' }), field('Title', title, { name: 'title' }),
        field('Date and time', at, { name: 'examAt' }), field('Venue', venue, { name: 'venue' }), field('Notes', notes, { name: 'notes' }));
      return () => {
        const examAt = inputToIso(at.value);
        if (!examAt) throw fieldError('examAt', 'Choose a valid date and time');
        return { subject: subject.value, title: title.value, examAt, venue: venue.value, notes: notes.value };
      };
    },
    submit: (p) => (item ? patch(`/exams/${item.id}`, p) : post('/exams', p)),
    onDone: (res) => { toast(item ? 'Exam updated' : 'Exam added'); onSaved?.(res.data); },
  });
}

async function linkOptions() {
  const [a, e] = await Promise.all([get('/assignments?pageSize=100&sort=due'), get('/exams?pageSize=100')]);
  return { assignments: a.data.filter((x) => x.status !== 'completed'), exams: e.data };
}

export async function openStudyPlanForm({ item, defaults = {}, onSaved } = {}) {
  let opts = { assignments: [], exams: [] };
  try { opts = await linkOptions(); } catch { /* links are optional */ }
  return formDialog({
    title: item ? 'Edit study plan' : 'Plan a study session', submitText: item ? 'Save changes' : 'Add to plan',
    build(form) {
      const subject = input({ type: 'text', maxlength: 100, value: item?.subject ?? defaults.subject ?? '' });
      const start = input({ type: 'datetime-local', value: item?.plannedStart ? isoToInput(item.plannedStart) : defaultInput(2) });
      const mins = input({ type: 'number', min: 5, max: 720, step: 5, value: item?.plannedMinutes ?? 60, inputmode: 'numeric' });
      const asg = select([['', '— none —'], ...opts.assignments.map((a) => [a.id, a.title])], item?.assignmentId ?? defaults.assignmentId ?? '');
      const exam = select([['', '— none —'], ...opts.exams.map((x) => [x.id, `${x.subject}: ${x.title}`])], item?.examId ?? defaults.examId ?? '');
      const notes = textarea({ maxlength: 2000, rows: 3 }); notes.value = item?.notes ?? '';
      form.append(field('Subject', subject, { name: 'subject' }),
        h('div', { class: 'row' }, field('Starts', start, { name: 'plannedStart' }), field('Minutes', mins, { name: 'plannedMinutes' })),
        field('For assignment', asg, { name: 'assignmentId' }), field('For exam', exam, { name: 'examId' }), field('Notes', notes, { name: 'notes' }));
      return () => {
        const plannedStart = inputToIso(start.value);
        if (!plannedStart) throw fieldError('plannedStart', 'Choose a valid start time');
        return { subject: subject.value, plannedStart, plannedMinutes: Number(mins.value), notes: notes.value,
          assignmentId: asg.value || null, examId: exam.value || null };
      };
    },
    submit: (p) => (item ? patch(`/study-sessions/${item.id}`, p) : post('/study-sessions/plan', p)),
    onDone: (res) => { toast('Study plan saved'); onSaved?.(res.data); },
  });
}

export async function openStudyStartForm({ onStarted } = {}) {
  let opts = { assignments: [], exams: [] };
  try { opts = await linkOptions(); } catch { /* optional */ }
  return formDialog({
    title: 'Start a focus session', submitText: 'Start focusing',
    build(form) {
      const subject = input({ type: 'text', maxlength: 100, placeholder: 'What are you studying?' });
      const focus = input({ type: 'number', min: 1, max: 240, value: 25, inputmode: 'numeric' });
      const brk = input({ type: 'number', min: 1, max: 60, value: 5, inputmode: 'numeric' });
      const asg = select([['', '— none —'], ...opts.assignments.map((a) => [a.id, a.title])], '');
      const exam = select([['', '— none —'], ...opts.exams.map((x) => [x.id, `${x.subject}: ${x.title}`])], '');
      form.append(field('Subject', subject, { name: 'subject' }),
        h('div', { class: 'row' }, field('Focus minutes', focus, { name: 'focusMinutes' }), field('Break minutes', brk, { name: 'breakMinutes' })),
        field('For assignment', asg, { name: 'assignmentId' }), field('For exam', exam, { name: 'examId' }));
      return () => ({ subject: subject.value, focusMinutes: Number(focus.value), breakMinutes: Number(brk.value),
        assignmentId: asg.value || undefined, examId: exam.value || undefined });
    },
    submit: (p) => post('/study-sessions/start', p),
    onDone: (res) => { toast('Focus session started'); onStarted?.(res.data); },
  });
}

// Quick note: creates the note on the server immediately, then the caller opens the editor.
export async function quickCreateNote() {
  const res = await post('/notes', { title: 'Untitled note' });
  return res.data;
}
