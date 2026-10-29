import { h, mount, icon } from '../dom.js';
import { post, patch, del, setCsrf, bus } from '../api.js';
import { state, setUser, applyTheme, applyAccent, onUserChange } from '../store.js';
import { field, input, select, textarea, clearErrors, showErrors, setBusy, toast, toastError, openModal } from '../ui.js';
import { DAYS } from '../time.js';
import { navigate } from '../router.js';
const themeChoices = [
  ['light', 'Light', 'sun', 'A bright, clear workspace'],
  ['dark', 'Dark', 'moon', 'Easy on the eyes'],
  ['system', 'System', 'monitor', 'Follow your device'],
];
const accentChoices = [
  ['blue', '#397df6', 'Blue'],
  ['purple', '#8b5cf6', 'Purple'],
  ['green', '#16a875', 'Green'],
  ['cyan', '#0891b2', 'Cyan'],
  ['orange', '#e87932', 'Orange'],
];
const settingsSections = [
  ['profile', 'Profile', 'user'],
  ['account', 'Account', 'lock'],
  ['appearance', 'Appearance', 'sun'],
  ['notifications', 'Notifications', 'bell'],
  ['data-privacy', 'Data & Privacy', 'shield'],
  ['danger-zone', 'Danger Zone', 'trash'],
];

function formCard({ id, title, description, fields, saveLabel, run, okMessage, iconName, topSave = false, fieldsClass = '' }) {
  const btn = h('button', { class: `btn btn-primary${topSave ? ' settings-top-save' : ''}`, type: 'submit' },
    topSave ? icon('check') : null, saveLabel);
  const form = h('form', { id, class: 'card card-form settings-card', novalidate: true, 'aria-label': title },
    h('div', { class: 'card-body' },
      h('div', { class: 'settings-card-head' },
        h('span', { class: 'settings-section-icon' }, icon(iconName)),
        h('div', { class: 'settings-card-title' }, h('h3', {}, title), description ? h('p', { class: 'muted small' }, description) : null),
        topSave ? btn : null,
      ),
      h('div', { class: `settings-form-fields ${fieldsClass}` }, ...fields),
    ),
    topSave ? null : h('div', { class: 'card-foot' }, btn),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    setBusy(btn, true);
    try {
      const saved = await run();
      if (saved !== false) toast(okMessage);
    } catch (error) {
      showErrors(form, error);
    } finally {
      setBusy(btn, false);
    }
  });
  return form;
}

function sectionNav() {
  const links = settingsSections.map(([id, label, iconName], index) => h('a', {
    href: `#${id}`,
    class: `settings-nav-link${id === 'danger-zone' ? ' settings-nav-danger' : ''}`,
    'aria-current': index === 0 ? 'location' : null,
    onclick: (event) => {
      event.preventDefault();
      const target = document.getElementById(id);
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      links.forEach((link) => {
        if (link === event.currentTarget) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    },
  }, icon(iconName), h('span', {}, label), icon('chevron')));
  return h('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' },
    h('p', { class: 'settings-nav-label' }, 'SETTINGS'),
    ...links,
  );
}

export function settingsPage(container) {
  const u = state.user;
  const makeInitials = (user) => (user?.name ?? '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';

  const avatar = h('div', { class: 'avatar settings-avatar', role: 'img', 'aria-label': `Your avatar: the letter ${makeInitials(u)}` }, makeInitials(u));
  const profileAvatar = h('div', { class: 'avatar settings-form-avatar', role: 'img', 'aria-label': `Your avatar: the letter ${makeInitials(u)}` }, makeInitials(u));
  const summaryName = h('strong', {}, u.name);
  const summaryEmail = h('span', { class: 'muted small' }, u.email);
  let themeRadioInputs = [];
  const profileSummary = h('a', { class: 'settings-profile-summary', href: '#profile', 'aria-label': 'Go to profile settings' },
    avatar,
    h('span', { class: 'settings-summary-copy' }, summaryName, summaryEmail),
    icon('chevron'),
  );
  profileSummary.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('profile')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });
  const stopUserWatch = onUserChange((user) => {
    if (!user) return;
    const initials = makeInitials(user);
    avatar.textContent = initials;
    avatar.setAttribute('aria-label', `Your avatar: the letter ${initials}`);
    profileAvatar.textContent = initials;
    profileAvatar.setAttribute('aria-label', `Your avatar: the letter ${initials}`);
    summaryName.textContent = user.name;
    summaryEmail.textContent = user.email;
    themeRadioInputs.forEach((radio) => { radio.checked = radio.value === user.theme; });
  });

  const name = input({ type: 'text', value: u.name, maxlength: 100, autocomplete: 'name' });
  const email = input({ type: 'email', value: u.email, autocomplete: 'email' });
  const currentProfilePassword = input({ type: 'password', autocomplete: 'current-password' });
  const goal = textarea({ maxlength: 500, rows: 4, placeholder: 'What do you want to achieve this term?' });
  goal.value = u.learningGoal ?? '';

  const profile = formCard({
    id: 'profile',
    title: 'Profile',
    description: 'Update your personal information.',
    iconName: 'user',
    topSave: false,
    saveLabel: 'Save Changes',
    fieldsClass: 'profile-fields',
    fields: [
      field('Full Name', name, { name: 'name' }),
      field('Email Address', email, { name: 'email' }),
      field('Current Password', currentProfilePassword, { name: 'currentPassword', hint: 'Required only when changing your email.' }),
      field('Learning Goal', goal, { name: 'learningGoal', hint: 'Optional. Up to 500 characters.' }),
      h('div', { class: 'field settings-avatar-field' }, h('span', { class: 'label' }, 'Profile avatar'), profileAvatar),
    ],
    run: async () => {
      const body = { name: name.value, learningGoal: goal.value };
      if (email.value.trim().toLowerCase() !== state.user.email) {
        body.email = email.value;
        body.currentPassword = currentProfilePassword.value;
      }
      const response = await patch('/me', body);
      setUser(response.data);
      currentProfilePassword.value = '';
    },
    okMessage: 'Profile saved',
  });

  const passwordCurrent = input({ type: 'password', autocomplete: 'current-password' });
  const passwordNew = input({ type: 'password', autocomplete: 'new-password' });
  const passwordConfirm = input({ type: 'password', autocomplete: 'new-password' });
  const password = formCard({
    id: 'account',
    title: 'Change Password',
    description: 'Keep your account secure.',
    iconName: 'lock',
    saveLabel: 'Update Password',
    fields: [
      field('Current Password', passwordCurrent, { name: 'currentPassword' }),
      field('New Password', passwordNew, { name: 'newPassword', hint: 'At least 10 characters. Other devices will be signed out.' }),
      field('Confirm New Password', passwordConfirm, { name: 'confirmPassword' }),
    ],
    run: async () => {
      if (passwordNew.value !== passwordConfirm.value) {
        const errorField = password.querySelector('[name="confirmPassword"]');
        const message = password.querySelector(`#${errorField.id}-err`);
        errorField.setAttribute('aria-invalid', 'true');
        message.textContent = 'Passwords do not match.';
        message.classList.remove('hidden');
        errorField.focus();
        return false;
      }
      await post('/auth/change-password', { currentPassword: passwordCurrent.value, newPassword: passwordNew.value });
      passwordCurrent.value = '';
      passwordNew.value = '';
      passwordConfirm.value = '';
    },
    okMessage: 'Password changed',
  });

  const timezones = [...new Set(['UTC', u.timezone, ...(Intl.supportedValuesOf?.('timeZone') ?? [])])].sort();
  const themeRadios = themeChoices.map(([value, label, iconName, hint]) => {
    const radio = h('input', { type: 'radio', name: 'themeChoice', value, checked: value === u.theme });
    themeRadioInputs.push(radio);
    return h('label', { class: 'theme-choice' }, radio,
      h('span', { class: 'theme-choice-icon' }, icon(iconName)),
      h('span', { class: 'theme-choice-copy' }, h('strong', {}, label), h('span', { class: 'muted small' }, hint)),
      h('span', { class: 'theme-choice-check' }, icon('check')),
    );
  });
  const themeOptions = h('div', { class: 'theme-options', role: 'radiogroup', 'aria-label': 'Color theme' }, themeRadios);
  const accentSelected = (() => {
    try { return localStorage.getItem('sm-accent') || 'blue'; } catch { return 'blue'; }
  })();
  const accentSwatches = accentChoices.map(([value, color, label]) => {
    const swatch = h('button', {
      class: `accent-swatch accent-${value}`,
      type: 'button',
      'aria-label': `${label} accent`,
      'aria-pressed': String(value === accentSelected),
      title: label,
      onclick: () => {
        applyAccent(value);
        accentSwatches.forEach((button) => button.setAttribute('aria-pressed', String(button === swatch)));
      },
    }, h('span', {}, icon('check')));
    swatch.dataset.color = color;
    return swatch;
  });
  const accentOptions = h('div', { class: 'accent-options', role: 'group', 'aria-label': 'Accent color' }, accentSwatches);
  const timezone = select(timezones, u.timezone);
  const weekStart = select(DAYS.map((day, index) => [index, day]), u.weekStart);
  const appearance = formCard({
    id: 'appearance',
    title: 'Appearance',
    description: 'Personalize how StudyMate looks on this device.',
    iconName: 'sun',
    saveLabel: 'Save preferences',
    fields: [
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Theme'), themeOptions),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Accent color'), accentOptions),
      field('Time zone', timezone, { name: 'timezone', hint: 'Used for today, deadlines, reminders, and your timetable.' }),
      field('Week starts on', weekStart, { name: 'weekStart' }),
    ],
    run: async () => {
      const selectedTheme = themeOptions.querySelector('input:checked')?.value ?? 'system';
      const response = await patch('/me/preferences', {
        theme: selectedTheme,
        timezone: timezone.value,
        weekStart: Number(weekStart.value),
      });
      setUser(response.data);
      applyTheme(response.data.theme);
    },
    okMessage: 'Preferences saved',
  });
  themeOptions.addEventListener('change', async () => {
    const selected = themeOptions.querySelector('input:checked');
    if (!selected) return;
    applyTheme(selected.value);
    try {
      const response = await patch('/me/preferences', { theme: selected.value });
      setUser(response.data);
    } catch { /* theme already applied locally; will sync on next form save */ }
  });

  const notificationCheckbox = (label, key) => {
    const checkbox = h('input', { type: 'checkbox', checked: u.notifications[key] });
    return [checkbox, h('label', { class: 'check settings-notification-option' },
      checkbox, h('span', { class: 'settings-checkmark' }, icon('check')),
      h('span', {}, label),
    )];
  };
  const [deadlinesCheckbox, deadlinesLabel] = notificationCheckbox('Assignment deadlines and overdue work', 'deadlines');
  const [examsCheckbox, examsLabel] = notificationCheckbox('Upcoming exams', 'exams');
  const [studyCheckbox, studyLabel] = notificationCheckbox('Planned study sessions', 'study');
  const notifications = formCard({
    id: 'notifications',
    title: 'Notifications',
    description: 'Manage the in-app reminders you want to receive.',
    iconName: 'bell',
    saveLabel: 'Save Notification Settings',
    fields: [deadlinesLabel, examsLabel, studyLabel],
    run: async () => {
      const response = await patch('/me/preferences', { notifications: {
        deadlines: deadlinesCheckbox.checked,
        exams: examsCheckbox.checked,
        study: studyCheckbox.checked,
      } });
      setUser(response.data);
    },
    okMessage: 'Notification settings saved',
  });

  const exportButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    setBusy(exportButton, true, 'Preparing…');
    try {
      const response = await fetch('/api/v1/me/export', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const anchor = h('a', { href: URL.createObjectURL(blob), download: 'studymate-export.json' });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
      toast('Export downloaded');
    } catch (error) {
      toastError(error, 'Export failed. Please try again.');
    } finally {
      setBusy(exportButton, false);
    }
  } }, icon('download'), 'Download my data (JSON)');
  const data = h('section', { id: 'data-privacy', class: 'card settings-card settings-info-card', 'aria-labelledby': 'data-title' },
    h('div', { class: 'card-body' },
      h('div', { class: 'settings-card-head' },
        h('span', { class: 'settings-section-icon' }, icon('shield')),
        h('div', { class: 'settings-card-title' },
          h('h3', { id: 'data-title' }, 'Data & Privacy'),
          h('p', { class: 'muted small' }, 'Your information stays yours. Export a copy whenever you need it.'),
        ),
      ),
      h('div', { class: 'settings-export-details' },
        h('p', { class: 'muted small' }, 'Your JSON export includes your profile, assignments, classes, notes, exams, study sessions, dictionary vocabulary, and notifications. Passwords and authentication tokens are never included.'),
        exportButton,
      ),
    ),
  );

  const confirmDialog = ({ title, intro, word, button, endpoint, method, after }) => {
    const form = h('form', { novalidate: true });
    const passwordInput = input({ type: 'password', autocomplete: 'current-password' });
    const confirmation = input({ type: 'text', autocomplete: 'off', placeholder: word });
    const submit = h('button', { class: 'btn btn-danger', type: 'submit' }, button);
    form.append(...intro,
      field('Password', passwordInput, { name: 'password' }),
      field(`Type ${word} to confirm`, confirmation, { name: 'confirm' }),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Cancel'),
        submit,
      ),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      setBusy(submit, true, 'Working…');
      try {
        const response = await method(endpoint, { password: passwordInput.value, confirm: confirmation.value });
        modal.close();
        after(response);
      } catch (error) {
        showErrors(form, error);
      } finally {
        setBusy(submit, false);
      }
    });
    const modal = openModal({ title, body: form });
    passwordInput.focus();
  };
  const resetButton = h('button', { class: 'btn btn-danger-outline', type: 'button', onclick: () => confirmDialog({
    title: 'Reset progress',
    word: 'RESET',
    button: 'Reset my progress',
    endpoint: '/me/reset-progress',
    method: post,
    intro: [
      h('p', {}, 'This permanently deletes your ', h('strong', {}, 'completed assignments'), ', your ', h('strong', {}, 'study-session history'), ' (completed and cancelled sessions), and your ', h('strong', {}, 'notifications'), '.'),
      h('p', {}, 'It keeps your account, timetable, notes, exams, open assignments, and planned study sessions. This cannot be undone.'),
    ],
    after: (response) => {
      toast(`Progress reset: ${response.data.completedAssignmentsDeleted} assignment(s) and ${response.data.studySessionsDeleted} study session(s) removed.`);
      navigate('/');
    },
  }) }, icon('refresh'), 'Reset progress');
  const deleteButton = h('button', { class: 'btn btn-danger-outline', type: 'button', onclick: () => confirmDialog({
    title: 'Delete account',
    word: 'DELETE',
    button: 'Permanently delete my account',
    endpoint: '/me',
    method: del,
    intro: [
      h('p', {}, 'This permanently deletes your account and every assignment, class, note, exam, study session, and notification from the live database.'),
      h('p', {}, 'It cannot be undone. Encrypted backups may retain a copy until they expire. Consider downloading your data first.'),
    ],
    after: () => {
      bus.dispatchEvent(new CustomEvent('session-ended'));
      toast('Your account has been deleted.');
      navigate('/register');
    },
  }) }, icon('trash'), 'Delete account');
  const danger = h('section', { id: 'danger-zone', class: 'card settings-card settings-danger-card danger-zone', 'aria-labelledby': 'danger-title' },
    h('div', { class: 'card-body' },
      h('div', { class: 'settings-card-head' },
        h('span', { class: 'settings-section-icon settings-danger-icon' }, icon('trash')),
        h('div', { class: 'settings-card-title' },
          h('h2', { id: 'danger-title' }, 'Danger Zone'),
          h('p', { class: 'muted small' }, 'These actions can not be undone.'),
        ),
      ),
      h('div', { class: 'settings-danger-actions' },
        h('div', {}, h('strong', {}, 'Reset Progress'), h('p', { class: 'muted small' }, 'Remove completed work and study history while keeping your account.')),
        resetButton,
        h('div', {}, h('strong', {}, 'Delete Account'), h('p', { class: 'muted small' }, 'Permanently remove your account and its data.')),
        deleteButton,
      ),
    ),
  );

  const heading = h('header', { class: 'settings-page-head' },
    h('div', { class: 'settings-page-title' },
      h('span', { class: 'settings-hero-icon' }, icon('settings')),
      h('div', {}, h('h2', {}, 'Settings'), h('p', { class: 'muted' }, 'Manage your account, preferences and app settings.')),
    ),
    profileSummary,
  );
  const content = h('div', { class: 'settings-content' },
    h('div', { class: 'settings-section-group' }, h('p', { class: 'settings-group-label' }, 'PERSONAL'), profile),
    h('div', { class: 'settings-section-group' },
      h('p', { class: 'settings-group-label' }, 'PREFERENCES'),
      h('div', { class: 'settings-card-grid' }, password, appearance),
      h('div', { class: 'settings-card-grid' }, notifications, data),
    ),
    h('div', { class: 'settings-section-group' }, h('p', { class: 'settings-group-label' }, 'ACCOUNT ACTIONS'), danger),
  );
  mount(container,
    h('div', { class: 'settings-page' },
      heading,
      h('div', { class: 'settings-workspace' }, sectionNav(), content),
    ),
  );

  return () => {
    stopUserWatch();
  };
}
