import { h, mount, icon } from '../dom.js';
import { get, post } from '../api.js';
import { state } from '../store.js';
import { loading, errorState, emptyState, badge, priorityBadge, toastError, toast } from '../ui.js';
import { fmtDate, fmtDateTime, fmtDuration, countdown, relativeDue } from '../time.js';
import { navigate } from '../router.js';
import { openAssignmentForm, openClassForm, openExamForm, openStudyPlanForm, quickCreateNote } from '../forms.js';

const activityIcons = { assignment: 'tasks', note: 'note', exam: 'exam', study: 'timer', class: 'clock' };
const activityNames = { assignment: 'Assignment', note: 'Note', exam: 'Exam', study: 'Study session', class: 'Class' };
const activityDescriptions = {
  assignment: { added: 'New assignment created', updated: 'You updated an assignment', completed: 'Assignment completed' },
  note: { added: 'New note created', updated: 'You updated a note' },
  exam: { added: 'New exam scheduled', updated: 'You updated an exam' },
  class: { scheduled: 'New class scheduled', updated: 'You updated your timetable' },
  study: { completed: 'Study session completed' },
};

function dashboardEmpty(iconName, title, description, action) {
  return h('div', { class: 'dashboard-empty' },
    h('span', { class: 'dashboard-empty-icon' }, icon(iconName)),
    h('h4', {}, title),
    h('p', { class: 'muted small' }, description),
    action,
  );
}

export function dashboardPage(container) {
  let active = true;

  async function loadVocabulary(target) {
    mount(target, loading());
    try {
      const { data } = await get('/dictionary/vocabulary?page=1&pageSize=5');
      if (!active) return;
      if (!data.length) {
        mount(target, dashboardEmpty(
          'book',
          'No saved words yet',
          'Look up a word and save it to build your personal vocabulary.',
          h('a', { class: 'btn btn-sm btn-ghost', href: '#/dictionary' }, 'Browse Dictionary'),
        ));
        return;
      }

      mount(target, h('ul', { class: 'list vocabulary-list' }, data.map((item) => {
        const definitions = (Array.isArray(item.meanings) ? item.meanings : [])
          .flatMap((meaning) => (Array.isArray(meaning?.definitions) ? meaning.definitions : [])
            .map((definition) => definition?.definition))
          .filter(Boolean)
          .slice(0, 2);
        const savedAt = item.createdAt ?? item.updatedAt;
        return h('li', {},
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, item.word),
            definitions.length ? h('div', { class: 'muted small vocabulary-definition' }, definitions.join(' · ')) : null,
            savedAt ? h('div', { class: 'muted small vocabulary-date' }, `Saved ${fmtDate(savedAt)}`) : null,
          ),
        );
      })));
    } catch (err) {
      if (active) mount(target, errorState(err, () => loadVocabulary(target)));
    }
  }

  async function load() {
    mount(container, loading());
    let d;
    try { d = (await get('/dashboard')).data; } catch (err) { if (active) mount(container, errorState(err, load)); return; }
    if (!active) return;
    const first = (state.user?.name ?? '').split(' ')[0];
    const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: state.user.timezone }).format(new Date());
    const stat = (value, label, iconName, tone) => h('div', { class: `card stat dashboard-stat stat-${tone}` },
      h('span', { class: 'stat-icon' }, icon(iconName)),
      h('span', { class: 'value' }, String(value)),
      h('span', { class: 'label' }, label),
      h('span', { class: 'stat-arrow', 'aria-hidden': 'true' }, icon('right')),
    );
    const quick = (label, iconName, tone, fn) => h('button', { class: `btn quick-action quick-${tone}`, type: 'button', onclick: fn }, icon(iconName), label);
    const vocabulary = h('div', {});

    const welcome = h('section', { class: 'dashboard-welcome' },
      h('div', { class: 'welcome-copy' },
        h('div', { class: 'welcome-title' },
          h('span', { class: 'welcome-icon', 'aria-hidden': 'true' }, '👋'),
          h('h2', {}, 'Welcome back, ', h('span', { class: 'welcome-name' }, first)),
        ),
        h('p', { class: 'muted welcome-date' }, date),
      ),
      h('div', { class: 'quick-actions', role: 'group', 'aria-label': 'Quick actions' },
        quick('Assignment', 'plus', 'blue', () => openAssignmentForm({ onSaved: load })),
        quick('Class', 'clock', 'purple', () => openClassForm({ onSaved: load })),
        quick('Exam', 'exam', 'orange', () => openExamForm({ onSaved: load })),
        quick('Study Session', 'timer', 'green', () => openStudyPlanForm({ onSaved: load })),
        quick('Note', 'note', 'teal', async () => { try { const n = await quickCreateNote(); navigate(`/notes?id=${n.id}`); } catch (e) { toastError(e); } }),
        quick('Dictionary', 'book', 'violet', () => navigate('/dictionary')),
      ),
    );

    const stats = h('div', { class: 'grid dashboard-stats' },
      stat(d.pendingAssignments, 'Pending Assignments', 'tasks', 'blue'),
      stat(d.overdueAssignments, 'Overdue', 'clock', 'orange'),
      stat(d.upcomingExams, 'Upcoming Exams', 'exam', 'purple'),
      stat(d.completedThisWeek, `Completed this week (${d.completedAssignments} total)`, 'check', 'green'),
      stat(fmtDuration(d.studySecondsThisWeek), 'Studied This Week', 'timer', 'teal'),
    );

    const classes = h('section', { class: 'card dashboard-card', 'aria-labelledby': 'h-classes' },
      h('div', { class: 'card-head' }, h('h3', { id: 'h-classes' }, 'Today’s Classes'), h('a', { href: '#/classes' }, 'Timetable')),
      d.todaysClasses.length
        ? h('ul', { class: 'list' }, d.todaysClasses.map((c) => h('li', {},
          h('span', { class: 'row-icon row-purple' }, icon('clock')),
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, c.subject),
            h('div', { class: 'muted small' }, [c.location, c.lecturer].filter(Boolean).join(' · ')),
          ),
          h('span', { class: 'nowrap dashboard-time' }, `${c.startTime}–${c.endTime}`),
        )))
        : dashboardEmpty('calendar', 'No classes today.', 'Enjoy your free time!'),
    );

    const deadlines = h('section', { class: 'card dashboard-card', 'aria-labelledby': 'h-deadlines' },
      h('div', { class: 'card-head' }, h('h3', { id: 'h-deadlines' }, 'Upcoming Deadlines'), h('a', { href: '#/assignments' }, 'All assignments')),
      d.upcomingDeadlines.length
        ? h('ul', { class: 'list' }, d.upcomingDeadlines.map((a) => h('li', {},
          h('span', { class: 'row-icon row-blue' }, icon('tasks')),
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, a.title),
            h('div', { class: 'muted small' }, [a.subject, `${fmtDateTime(a.dueAt)} (${relativeDue(a.dueAt)})`].filter(Boolean).join(' · ')),
          ),
          priorityBadge(a.priority),
        )))
        : dashboardEmpty('tasks', 'You’re all caught up.', 'No upcoming deadlines.',
          h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => openAssignmentForm({ onSaved: load }) }, 'Add an assignment')),
    );

    const exams = h('section', { class: 'card dashboard-card', 'aria-labelledby': 'h-exams' },
      h('div', { class: 'card-head' }, h('h3', { id: 'h-exams' }, 'Upcoming Exams'), h('a', { href: '#/exams' }, 'All exams')),
      d.exams.length
        ? h('ul', { class: 'list' }, d.exams.map((x) => h('li', {},
          h('span', { class: 'row-icon row-purple' }, icon('exam')),
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, `${x.subject}: ${x.title}`),
            h('div', { class: 'muted small' }, [fmtDateTime(x.examAt), x.venue].filter(Boolean).join(' · ')),
          ),
          badge(`in ${countdown(x.secondsUntil)}`, 'warning'),
        )))
        : dashboardEmpty('calendar', 'No exams scheduled.', 'Keep up the good work!'),
    );

    const recentActivity = h('section', { class: 'card dashboard-card', 'aria-labelledby': 'h-activity' },
      h('div', { class: 'card-head' }, h('h3', { id: 'h-activity' }, 'Recent Activity')),
      d.recentActivity.length
        ? h('ul', { class: 'list activity-list' }, d.recentActivity.map((activity) => {
          const kind = activity.kind;
          const action = activity.action;
          return h('li', {},
            h('span', { class: `row-icon row-${kind === 'study' ? 'green' : kind === 'exam' ? 'purple' : 'blue'}` }, icon(activityIcons[kind] ?? 'clock')),
            h('div', { class: 'grow' },
              h('div', { class: 'title' }, activity.title),
              h('div', { class: 'muted small' }, activityDescriptions[kind]?.[action] ?? `${activityNames[kind] ?? kind} ${action}`),
            ),
            h('span', { class: 'muted small nowrap dashboard-time' }, fmtDateTime(activity.at)),
          );
        }))
        : dashboardEmpty('calendar', 'Nothing here yet.', 'Your recent assignments, notes, exams, and study sessions will show up here.'),
    );

    const dictionary = h('section', { class: 'card dashboard-card', 'aria-labelledby': 'h-dictionary' },
      h('div', { class: 'card-head' },
        h('h3', { id: 'h-dictionary' }, 'My Dictionary'),
        h('a', { href: '#/dictionary' }, 'View All Words'),
      ),
      vocabulary,
      h('a', { class: 'btn btn-sm btn-ghost dictionary-browse', href: '#/dictionary' }, icon('book'), 'Browse Dictionary'),
    );

    mount(container,
      welcome,
      stats,
      h('div', { class: 'grid dashboard-grid-three' }, classes, deadlines, exams),
      h('div', { class: 'grid dashboard-grid-two' }, recentActivity, dictionary),
    );
    loadVocabulary(vocabulary);
  }
  load();
  return () => { active = false; };
}
