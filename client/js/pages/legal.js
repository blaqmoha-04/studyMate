// Privacy Policy, Terms of Service, Cookie Policy and Refund Policy.
// These are TEMPLATES that describe what this software actually does. They are not legal advice: the operator must
// review them (ideally with a lawyer in their jurisdiction) before opening StudyMate to the public. Operator details
// and retention periods come from the server configuration, never from hard-coded guesses.
import { h, icon } from '../dom.js';
import { get } from '../api.js';
import { state } from '../store.js';
import { loading, errorState } from '../ui.js';

const P = (...c) => h('p', {}, ...c);
const UL = (items) => h('ul', {}, items.map((i) => h('li', {}, i)));
const S = (title, ...c) => h('section', {}, h('h2', {}, title), ...c);
const table = (head, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
  h('thead', {}, h('tr', {}, head.map((c) => h('th', { scope: 'col' }, c)))),
  h('tbody', {}, rows.map((r) => h('tr', {}, r.map((cell, i) => h('td', { 'data-label': head[i] }, cell)))))));

function operatorBlock(info) {
  const o = info.operator;
  if (!info.configured) {
    return h('div', { class: 'form-error', role: 'alert' }, 'The operator of this installation has not yet entered their name and contact details (OPERATOR_NAME and OPERATOR_EMAIL). Until they do, this service should not be offered to the public.');
  }
  return h('address', {}, h('strong', {}, o.name), o.address ? [h('br'), o.address] : null, h('br'), 'Email: ', h('a', { href: `mailto:${o.email}` }, o.email));
}

function privacy(info) {
  const { retention: r } = info;
  return [
    P('This policy explains what personal data StudyMate collects, why, who sees it, how long it is kept, and what you can do about it. It describes what the software actually does.'),
    S('Who is responsible', P('The person or organisation that runs this StudyMate installation (the "operator") decides how your data is used and is responsible for it:'), operatorBlock(info),
      P('For any privacy question or request, use the email address above.')),
    S('What we collect and why', table(['Data', 'What it is', 'Why'], [
      ['Account details', 'Your name, email address, time zone, and a one-way hash of your password. We never store your password itself and cannot read it.', 'To create your account, sign you in and show dates in your time zone.'],
      ['Preferences', 'Theme, first day of the week, notification settings, and the optional "learning goal" you may write.', 'To personalise the app. The learning goal is optional and visible only to you.'],
      ['Your study content', 'Assignments, class timetable, notes, exams, study sessions and timer records, and reminders generated from them.', 'This is the service you asked for. Only you can see it.'],
      ['Sign-in session', 'A random token (stored only as a one-way hash) and its expiry time.', 'To keep you signed in. Removed when you sign out or after a period of no use.'],
      ['Consent record', 'When you accepted the Terms of Service and which version.', 'To show what you agreed to.'],
      ['Server logs', 'A request id, the request method and page address (without search text), the result code and timing. No passwords, cookies, emails or note contents.', 'To keep the service running and secure.'],
      ['Web-server logs', 'The server in front of the app may record your IP address and browser type.', 'Security and abuse prevention. Ask the operator how long these are kept.'],
    ]), P('We do not ask for your date of birth, phone number, home address, ID documents, location, photos or contacts, and the app does not collect them.')),
    S('What we do not do', UL(['We do not show advertising and we do not sell or rent your data.', 'We do not use analytics, tracking pixels, or third-party scripts, fonts or images in the app.', 'We do not build profiles about you or make automated decisions about you.', 'We do not send marketing email. The only email the app can send is a password-reset message, and only when you ask for one.'])),
    S('Why we may process your data', P('Because it is needed to provide the service you signed up for; because you chose to provide it (for example the optional learning goal); and because we have a legitimate interest in keeping the service secure and preventing abuse. You can withdraw consent for optional data at any time by editing or deleting it.')),
    S('Who we share it with', P('Nobody, except service providers the operator uses to run StudyMate (only as needed to do so) and public authorities where the law requires it.'),
      info.operator.processors ? P('Providers named by the operator: ', info.operator.processors) : P('The operator has not listed outside providers. Ask them where the servers are located and who hosts them.'),
      P('If password-reset email is enabled, your email address and the reset message pass through the operator\u2019s email provider.')),
    S('How long we keep it', UL(['Your account and content: until you delete it. Deleting your account (Settings \u2192 Delete account) removes it from the live database immediately.',
      `Backups: encrypted backups may keep a copy for up to ${r.backupDays} days after deletion, then expire.`,
      `Sign-in sessions end when you sign out or after ${r.sessionDays} days of no use. Password-reset links last 1 hour. Dismissed reminders are removed after 30 days.`, 'Server logs and web-server logs: as set by the operator.'])),
    S('Your rights', UL(['See and download your data: Settings \u2192 Download my data.', 'Correct it: Settings \u2192 Profile.', 'Delete it: Settings \u2192 Delete account. If you cannot sign in, email the operator to request deletion; they will check it is really you and then delete the account.',
      'Clear your finished work and history without deleting your account: Settings \u2192 Reset progress.', 'Object to or restrict processing, withdraw consent, or ask questions: email the operator.',
      'Complain to a data protection authority (in Ghana, the Data Protection Commission).']), P('We aim to answer requests within 30 days.')),
    S('Security', P('Passwords are stored as one-way Argon2id hashes. Sign-in cookies are HttpOnly and, over HTTPS, Secure. Each person can only reach their own records. Backups are encrypted. No system is perfectly secure; if a breach affecting you occurs, we will tell the affected people and the relevant authority where the law requires.')),
    S('Children', P('StudyMate does not ask users to confirm their age, verify ages, or provide parental-consent features. The operator must decide who may use their installation and comply with the laws that apply to them.')),
    S('Changes to this policy', P('If we change this policy in a way that matters, we will update the version below and tell signed-in users in the app.')),
  ];
}

function terms(info) {
  const law = info.operator.jurisdiction;
  return [
    P('By creating an account or using StudyMate you agree to these terms. If you do not agree, please do not use it.'),
    S('Who runs this service', P('StudyMate is operated by:'), operatorBlock(info)),
    S('Who may use it', P('There is no age-confirmation step when creating an account. The operator is responsible for making the service available only where permitted by applicable law. Give accurate information when you register. One account is for one person.')),
    S('Your account', P('Keep your password private and use one that you do not use elsewhere. Tell the operator promptly if you think someone else has accessed your account. You are responsible for activity under your account.')),
    S('Acceptable use', UL(['Do not break the law or use StudyMate to harass, threaten or harm others.', 'Do not try to access other people\u2019s accounts or data, probe for weaknesses, overload the service, or bypass its limits.', 'Do not store content you have no right to store.'])),
    S('Your content', P('You own the notes, assignments and other content you put into StudyMate. You give the operator permission to store and process it only to run the service for you (for example, saving it and making backups). The operator does not claim any other rights over it.')),
    S('The service', P('StudyMate is provided as available and may change, be interrupted, or be withdrawn. Reminders are shown in the app when it is open and are not guaranteed to arrive on time, so do not rely on them as your only way to track deadlines. Download your data from Settings regularly if it matters to you.')),
    S('Cost', P('StudyMate is free to use. There are no fees or charges. See the Refund Policy.')),
    S('Ending your use', P('You can stop at any time and delete your account in Settings. The operator may suspend or close accounts that break these terms or put the service or other people at risk, and will explain why where reasonably possible.')),
    S('No warranty and limits on liability', P('To the extent the law allows, StudyMate is provided "as is" without promises that it will be error-free or always available, and the operator is not liable for indirect or consequential losses or for loss of data. Nothing in these terms limits any right or liability that cannot be limited by law.')),
    S('Governing law', law ? P(`These terms are governed by the laws of ${law}.`) : P('The operator has not stated which country\u2019s law governs these terms.')),
    S('Changes to these terms', P('If these terms change in a way that matters, the version below will be updated and signed-in users will be told in the app. Continuing to use StudyMate after that means you accept the new terms.')),
  ];
}

function cookies() {
  return [
    P('StudyMate uses only what it needs to work. It does not use analytics, advertising or tracking cookies, and no third party sets cookies or stores anything on your device through StudyMate.'),
    S('What is stored on your device', table(['Name', 'Type', 'Purpose', 'How long'], [
      ['sm_sid', 'Cookie (essential)', 'Keeps you signed in. HttpOnly, SameSite=Lax, and Secure on HTTPS.', 'Until you sign out, or after a period of no use (see the Privacy Policy).'],
      ['sm-theme', 'Local storage', 'Remembers your light or dark theme so pages do not flash the wrong colours.', 'Until you clear your browser data.'],
      ['sm-collapsed', 'Local storage', 'Remembers whether you collapsed the sidebar.', 'Until you clear your browser data.'],
      ['sm-notice-ack', 'Local storage', 'Remembers that you dismissed the cookie notice.', 'Until you clear your browser data.'],
    ])),
    S('Do I need to give consent?', P('These items are strictly necessary for the service you asked for or are simple display preferences you set yourself, so there is no optional tracking to accept or reject. If optional cookies are ever added, this policy will change and you will be asked first.')),
    S('Controlling them', P('You can delete cookies and site data in your browser settings at any time. Deleting the sign-in cookie signs you out; deleting the others only resets your display preferences.')),
  ];
}

function refunds() {
  return [
    P('StudyMate is currently free. No payment is taken for any feature, so there is nothing to refund.'),
    S('If this changes', P('Before any paid feature is introduced, this policy will be replaced with clear refund and cancellation terms, the full price (including taxes and any fees) will be shown before you pay, and nothing will be charged without your explicit action.')),
    S('Questions', P('Email the operator using the details in the Terms of Service.')),
  ];
}

const PAGES = { privacy: ['Privacy Policy', privacy], terms: ['Terms of Service', terms], cookies: ['Cookie Policy', cookies], refunds: ['Refund Policy', refunds] };
export const LEGAL_TITLES = Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, v[0]]));

export function footerLinks() {
  return h('nav', { class: 'legal-links', 'aria-label': 'Legal' },
    h('a', { href: '#/privacy' }, 'Privacy Policy'),
    h('a', { href: '#/terms' }, 'Terms of Service'),
    h('a', { href: '#/cookies' }, 'Cookie Policy'),
    h('a', { href: '#/refunds' }, 'Refund Policy'),
  );
}

export function legalPage(kind) {
  const [title, build] = PAGES[kind];
  const body = h('div', {}, loading());
  const load = () => get('/legal').then(({ data }) => {
    body.replaceChildren(...build(data), h('hr'), h('p', { class: 'meta' }, `Version ${data.version}.`));
  }).catch((err) => body.replaceChildren(errorState(err, load)));
  load();
  return h('div', { class: 'legal-wrap' },
    h('header', { class: 'legal-head' }, h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, icon('cap')), h('span', {}, 'StudyMate')),
      h('a', { class: 'btn btn-sm', href: state.user ? '#/' : '#/login' }, state.user ? 'Back to StudyMate' : 'Back to sign in')),
    h('main', { id: 'main', class: 'legal', tabindex: '-1' }, h('h1', {}, title), body),
    footerLinks());
}
