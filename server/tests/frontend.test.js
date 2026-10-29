// Frontend smoke tests: the REAL client modules run in jsdom against a REAL server + PostgreSQL.
// Not a substitute for testing in real browsers (layout, CSS, <dialog> behaviour are not exercised) — see README.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const clientDir = path.join(root, 'client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server; let built; let base; let dom; let jar = '';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((e) => e.textContent.includes(text));
async function waitFor(fn, label, timeout = 5000) {
  const t = Date.now();
  for (;;) { let v; try { v = fn(); } catch { v = null; } if (v) return v; if (Date.now() - t > timeout) throw new Error(`waitFor timed out: ${label}\nDOM: ${document.body.textContent.slice(0, 400)}`); await sleep(25); }
}
const setValue = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); };
const submit = (form) => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const go = (hash) => { window.location.hash = hash; };
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

before(async () => {
  built = createApp(loadConfig({ ...process.env, RATE_LIMIT_MULTIPLIER: '1000', OPERATOR_NAME: 'Test Operator Ltd', OPERATOR_EMAIL: 'privacy@example.test', OPERATOR_ADDRESS: '1 Test Street', OPERATOR_JURISDICTION: 'Ghana' }));
  await built.ctx.db.query('TRUNCATE users CASCADE');
  await new Promise((r) => { server = built.app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;

  dom = new JSDOM(fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8'), { url: `${base}/`, pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {}; w.confirm = () => true;
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
  Object.assign(globalThis, { window: w, document: w.document, Node: w.Node, localStorage: w.localStorage, history: w.history, location: w.location });
  // Cookie-jar fetch that behaves like a same-origin browser.
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const res = await nativeFetch(new URL(url, base), { ...opts, headers: { ...opts.headers, Origin: base, ...(jar ? { Cookie: jar } : {}) } });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const [k, v] = pair.split('='); jar = jar.split('; ').filter((x) => x && !x.startsWith(`${k}=`)).concat(v ? [`${k}=${v}`] : []).join('; '); }
    return res;
  };
  await import(pathToFileURL(path.join(clientDir, 'js/app.js')).href);
});
after(async () => { await new Promise((r) => server.close(r)); await built.close(); });

describe('client in jsdom', () => {
  it('shows the sign-in screen when signed out', async () => {
    await waitFor(() => $('form input[type=password]') && byText('h1', 'Welcome back'), 'login form');
    assert.ok($('.auth-layout .auth-promo'), 'auth page includes the reference-style promotional panel');
    assert.ok($('.auth-card .legal-links'), 'legal links remain visible on the auth card');
    const background = await fetch('/assets/auth-study-background.png');
    assert.equal(background.status, 200);
    assert.match(background.headers.get('content-type'), /image\/png/);
    assert.equal(window.location.hash, '#/login');
  });

  it('shows an informational cookie notice that can be dismissed and stays dismissed', async () => {
    const notice = await waitFor(() => $('.notice'), 'cookie notice');
    assert.match(notice.textContent, /one essential cookie/); assert.match(notice.textContent, /no analytics, advertising or tracking/i);
    assert.equal(notice.getAttribute('aria-label'), 'Cookie notice'); assert.ok(notice.querySelector('a[href="#/cookies"]'));
    assert.equal(notice.querySelectorAll('button').length, 1, 'a notice, not a fake choice');
    click(notice.querySelector('button')); assert.equal($('.notice'), null); assert.equal(window.localStorage.getItem('sm-notice-ack'), '1');
  });

  it('serves Privacy, Terms, Cookie and Refund pages built from the operator configuration', async () => {
    const expect = { '#/privacy': ['Privacy Policy', 'Test Operator Ltd', 'privacy@example.test', '1 Test Street', 'Data Protection Commission', 'do not send marketing email'],
      '#/terms': ['Terms of Service', 'One account is for one person', 'laws of Ghana', 'Test Operator Ltd'], '#/cookies': ['Cookie Policy', 'sm_sid', 'sm-theme', 'strictly necessary'], '#/refunds': ['Refund Policy', 'currently free', 'nothing to refund'] };
    for (const [hash, texts] of Object.entries(expect)) {
      go(hash); await waitFor(() => byText('h1', texts[0]), `${hash} heading`);
      await waitFor(() => !$('main .spinner') && /Version \d{4}-\d{2}-\d{2}/.test($('main').textContent), `${hash} loaded`);
      for (const t of texts.slice(1)) assert.ok($('main').textContent.includes(t), `${hash} should mention "${t}"`);
      if (hash === '#/privacy' || hash === '#/terms') assert.doesNotMatch($('main').textContent, /minimum age|at least \d+ years old|aged \d+ or over/i);
      assert.equal($$('.legal-links a').length, 4, `${hash} footer links`);
      if (hash === '#/privacy' || hash === '#/terms') assert.ok($('a[href="mailto:privacy@example.test"]'), `${hash} links to the operator's email`);
    }
    go('#/login'); await waitFor(() => byText('h1', 'Welcome back'), 'back to login');
    assert.equal($$('.legal-links a').length, 4, 'sign-in screen links to the legal pages');
  });

  it('skip link moves focus to the main content WITHOUT changing the route', async () => {
    const before = window.location.hash; click($('.skip-link'));
    assert.equal(window.location.hash, before); assert.equal(document.activeElement?.id, 'main');
  });

  it('registers through the UI and lands on the dashboard with real (empty) data', async () => {
    go('#/register');
    const form = await waitFor(() => byText('h1', 'Create your account') && $('form'), 'register form');
    const [name, email, pw] = form.querySelectorAll('input:not([type=checkbox])');
    const [termsBox] = [...form.querySelectorAll('input[type=checkbox]')];
    assert.ok(termsBox, 'Terms checkbox exists');
    assert.equal(termsBox.checked, false, 'Terms box must NOT be pre-ticked');
    assert.equal(form.querySelectorAll('input[type=checkbox]').length, 1, 'sign-up does not require age confirmation');
    assert.ok(form.querySelector('a[href="#/terms"]') && form.querySelector('a[href="#/privacy"]'), 'terms and privacy links');
    setValue(name, 'Kofi Mensah'); setValue(email, 'kofi@example.test'); setValue(pw, 'short'); submit(form);
    await waitFor(() => $('.field-error:not(.hidden)'), 'inline validation error');
    assert.match($('.field-error:not(.hidden)').textContent, /at least 10/i);
    setValue(pw, 'a-good-long-passphrase'); submit(form);                       // valid, but no consent given
    await waitFor(() => $('#c-acceptTerms-err:not(.hidden)'), 'terms consent error');
    assert.match($('#c-acceptTerms-err').textContent, /Terms of Service/);
    assert.ok(!byText('h2', 'Welcome back, Kofi'), 'must not register without consent');
    termsBox.checked = true; submit(form);
    await waitFor(() => byText('h2', 'Welcome back, Kofi'), 'dashboard heading');
    await waitFor(() => byText('.label', 'Pending Assignments'), 'stats');
    assert.equal(byText('.stat', 'Pending Assignments').querySelector('.value').textContent, '0');
    assert.ok($('nav[aria-label="Primary"]'));
    assert.equal($('a[aria-current="page"]').textContent.includes('Dashboard'), true);
  });

  it('shows the signed-in user’s saved vocabulary on the dashboard and links to the Dictionary page', async () => {
    const me = await fetch('/api/v1/me').then((r) => r.json());
    const words = ['dashboard-word-1', 'dashboard-word-2', 'dashboard-word-3', 'dashboard-word-4', 'dashboard-word-5', 'dashboard-word-6'];
    for (const word of words) {
      const response = await fetch('/api/v1/dictionary/vocabulary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.data.csrfToken },
        body: JSON.stringify({ word, meanings: [{ definitions: [{ definition: `Meaning for ${word}` }] }] }),
      });
      assert.equal(response.status, 201);
    }

    go('#/dictionary');
    await waitFor(() => $('a[aria-current="page"]')?.getAttribute('href') === '#/dictionary', 'Dictionary route');
    go('#/');
    await waitFor(() => $('a[aria-current="page"]')?.getAttribute('href') === '#/', 'dashboard route');
    const section = await waitFor(() => byText('section', 'My Dictionary'), 'My Dictionary section');
    await waitFor(() => section.textContent.includes('Meaning for dashboard-word-'), 'saved-word definitions');
    assert.equal(section.querySelectorAll('.list li').length, 5, 'dashboard shows no more than five saved words');
    assert.ok(section.querySelector('.list li').textContent.includes('Meaning for dashboard-word-'));
    assert.ok(section.textContent.includes('Saved '), 'saved dates are displayed');
    click(section.querySelector('a[href="#/dictionary"]'));
    await waitFor(() => $('a[aria-current="page"]')?.getAttribute('href') === '#/dictionary', 'View All Words navigation');
  });

  it('uses the top-bar search to open a Dictionary lookup', async () => {
    go('#/');
    await waitFor(() => $('a[aria-current="page"]')?.getAttribute('href') === '#/', 'dashboard route');
    const search = await waitFor(() => $('.topbar-search-input'), 'top-bar search');
    setValue(search, 'acumen');
    submit($('.topbar-search'));
    await waitFor(() => $('a[aria-current="page"]')?.getAttribute('href') === '#/dictionary', 'search navigates to Dictionary');
    await waitFor(() => $('input[aria-label="Word search"]')?.value === 'acumen', 'search term passed to Dictionary');
  });

  it('shows real calendar events and supports month, week, day, and event details', async () => {
    const { post, del } = await import(pathToFileURL(path.join(clientDir, 'js/api.js')).href);
    const created = await post('/assignments', {
      title: 'Calendar reference test',
      dueAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    });
    go('#/calendar');
    await waitFor(() => $('.calendar-page-view') && $('.calendar-page-title h2')?.textContent === 'Calendar', 'calendar layout');
    const event = await waitFor(() => [...$$('.calendar-upcoming-list .upcoming-event')]
      .find((button) => button.textContent.includes('Calendar reference test')), 'upcoming real event');
    assert.ok($('.calendar-page-icon .icon'), 'calendar title has an icon');
    assert.ok($('.calendar-legend'), 'event legend is present');
    assert.ok($$('.cal-view-toggle button').some((button) => button.textContent === 'Day'));
    click(event);
    await waitFor(() => $('dialog')?.textContent.includes('Calendar reference test'), 'event detail dialog');
    click($('dialog button'));
    click($$('.cal-view-toggle button').find((button) => button.textContent === 'Week'));
    await waitFor(() => $('.week'), 'week view');
    click($$('.cal-view-toggle button').find((button) => button.textContent === 'Day'));
    await waitFor(() => $('.calendar-day-view'), 'day view');
    click($('.calendar-view-all'));
    await waitFor(() => $('.month'), 'View all returns to the current month');
    click($$('.cal-view-toggle button').find((button) => button.textContent === 'Month'));
    await waitFor(() => $('.month'), 'month view');
    assert.ok([...$$('.month .ev')].some((button) => button.textContent.includes('Calendar reference test')), 'month grid includes the saved event');
    assert.ok($('.month .ev .ev-title .icon'), 'calendar events have category icons');
    await del(`/assignments/${created.data.id}`);
  });

  it('renders every page without errors and with working navigation links', async () => {
    const expect = { '#/assignments': 'No assignments yet', '#/classes': 'Your timetable is empty', '#/notes': 'No notes yet', '#/exams': 'No upcoming exams',
      '#/study': 'No active session', '#/calendar': 'Today', '#/notifications': 'You’re all caught up', '#/settings': 'Delete account' };
    for (const [hash, text] of Object.entries(expect)) {
      go(hash);
      await waitFor(() => $('a[aria-current="page"]')?.getAttribute('href') === hash, `${hash} should become the active route`);
      await waitFor(() => document.querySelector('main')?.textContent.includes(text), `${hash} should show "${text}"`);
      assert.ok(!$('main .state[role=alert]'), `${hash} rendered an error state`);
    }
    const links = $$('.nav a').map((a) => a.getAttribute('href'));
    assert.equal(links.length, 10);
  });

  it('creates an assignment through the dialog form and lists it', async () => {
    go('#/assignments');
    await waitFor(() => byText('h3', 'No assignments yet'), 'empty state');
    click(byText('button', 'New assignment'));
    const form = await waitFor(() => $('dialog form'), 'assignment dialog');
    submit(form);
    await waitFor(() => $('dialog .field-error:not(.hidden)'), 'title required error');
    setValue(form.querySelector('[name=title]'), 'Write lab report'); setValue(form.querySelector('[name=subject]'), 'Physics'); setValue(form.querySelector('[name=priority]'), 'high');
    submit(form);
    await waitFor(() => byText('td', 'Write lab report'), 'new row');
    assert.ok(byText('td', 'Physics')); assert.ok(byText('.badge', 'High'));
    assert.equal($('dialog'), null);
  });

  it('renders hostile user content as inert text (no HTML/script injection)', async () => {
    const { post } = await import(pathToFileURL(path.join(clientDir, 'js/api.js')).href);
    const evil = '<img src=x id="xss1" onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    await post('/assignments', { title: evil, subject: '<b id="xss2">bold</b>', dueAt: new Date(Date.now() + 86400000).toISOString() });
    await post('/notes', { title: evil, content: '<svg onload="window.__pwned=3">' });
    await post('/exams', { subject: evil, title: evil, examAt: new Date(Date.now() + 5 * 86400000).toISOString() });
    for (const hash of ['#/assignments', '#/notes', '#/exams', '#/']) {
      go(hash); await sleep(150);
      await waitFor(() => !$('main .spinner'), `${hash} loaded`);
      assert.equal(document.getElementById('xss1'), null, `${hash}: <img> was injected`);
      assert.equal(document.getElementById('xss2'), null);
      assert.equal($$('main img, main script, main svg[onload]').length, 0, `${hash}: markup leaked into DOM`);
    }
    go('#/assignments'); await waitFor(() => byText('td', '<img src=x id="xss1"'), 'literal text shown');
    assert.equal(window.__pwned, undefined);
  });

  it('autosaves note edits with visible status and protects against stale saves', async () => {
    go('#/notes'); await waitFor(() => $('.note-item'), 'note list');
    click($('.note-item'));
    const content = await waitFor(() => $('textarea[aria-label="Note content"]'), 'editor');
    setValue(content, 'Cells are the basic unit of life.');
    await waitFor(() => $('.save-status')?.textContent.includes('Unsaved'), 'unsaved status');
    await waitFor(() => $('.save-status')?.textContent.startsWith('Saved at'), 'saved status', 6000);
    const { get } = await import(pathToFileURL(path.join(clientDir, 'js/api.js')).href);
    const id = new URLSearchParams(window.location.hash.split('?')[1]).get('id');
    assert.equal((await get(`/notes/${id}`)).data.content, 'Cells are the basic unit of life.');
  });

  it('runs a focus session via the UI and records server time', async () => {
    go('#/study'); await waitFor(() => byText('button', 'Start a session'), 'start button');
    click(byText('button', 'Start a session'));
    const form = await waitFor(() => $('dialog form'), 'start dialog');
    setValue(form.querySelector('[name=subject]'), 'Biology'); submit(form);
    await waitFor(() => $('#clock')?.textContent.match(/^\d\d:\d\d$/), 'running clock');
    assert.ok(byText('.badge', 'Running'));
    click(byText('button', 'Pause')); await waitFor(() => byText('.badge', 'Paused'), 'paused');
    click(byText('button', 'Resume')); await waitFor(() => byText('.badge', 'Running'), 'resumed');
    click(byText('button', 'Complete'));
    await waitFor(() => byText('li', 'Biology') && byText('.timer-sub', 'Break time'), 'completed + break');
  });

  it('settings looks like a profile form: learning goal, avatar, footer Save bar and a Danger Zone', async () => {
    go('#/settings'); await waitFor(() => byText('h2', 'Danger Zone'), 'settings page');
    const profile = $('form[aria-label="Profile"]'); assert.ok(profile);
    const goal = profile.querySelector('textarea[name=learningGoal]'); assert.ok(goal); assert.ok(goal.placeholder.length > 0);
    assert.match(profile.querySelector('.avatar').getAttribute('aria-label'), /letter KM/); assert.equal(profile.querySelector('.avatar').textContent, 'KM');
    assert.equal(profile.querySelector('.avatar').getAttribute('role'), 'img');
    assert.ok(byText('.card-foot button', 'Save'), 'footer Save button');
    const dz = $('.danger-zone'); assert.match(dz.textContent, /can not be undone/); assert.ok(byText('.danger-zone button', 'Reset progress')); assert.ok(byText('.danger-zone button', 'Delete account'));
    assert.ok($$('.danger-zone .icon').length >= 2);
    setValue(goal, 'Graduate with first class honours'); submit(profile);
    const { get } = await import(pathToFileURL(path.join(clientDir, 'js/api.js')).href);
    await waitFor(() => $$('.toast').some((t) => t.textContent.includes('Profile saved')), 'saved toast');
    assert.equal((await get('/me')).data.learningGoal, 'Graduate with first class honours');
  });

  it('the "Download my data" button goes back to normal WITH its icon after being used', async () => {
    const btn = byText('button', 'Download my data'); assert.ok(btn.querySelector('svg'), 'icon present before use');
    click(btn);
    await waitFor(() => $$('.toast').some((t) => t.textContent.includes('Export downloaded')) && !btn.disabled, 'export finished');
    assert.ok(btn.textContent.includes('Download my data (JSON)'), 'label restored'); assert.ok(btn.querySelector('svg'), 'icon must survive the busy state');
  });

  it('settings no longer shows an explanatory sentence under the avatar', async () => {
    assert.ok($('.avatar')); assert.ok(!/GitHub|Google|outside service/i.test($('form[aria-label="Profile"]').textContent));
  });

  it('settings section navigation, theme/accent choices, and password confirmation work', async () => {
    const { get } = await import(pathToFileURL(path.join(clientDir, 'js/api.js')).href);
    const originalTheme = (await get('/me')).data.theme;
    const appearanceLink = $('.settings-nav-link[href="#appearance"]');
    click(appearanceLink);
    assert.equal(appearanceLink.getAttribute('aria-current'), 'location');
    assert.equal(window.location.hash, '#/settings', 'section navigation must not interfere with the app router');

    const darkTheme = $('input[name="themeChoice"][value="dark"]');
    darkTheme.checked = true;
    darkTheme.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
    click($('.accent-purple'));
    assert.equal(document.documentElement.getAttribute('data-accent'), 'purple');
    assert.equal(window.localStorage.getItem('sm-accent'), 'purple');

    const appearance = $('form[aria-label="Appearance"]');
    submit(appearance);
    await waitFor(() => $$('.toast').some((item) => item.textContent.includes('Preferences saved')), 'appearance preferences saved');
    const resetTheme = $(`input[name="themeChoice"][value="${originalTheme}"]`);
    resetTheme.checked = true;
    resetTheme.dispatchEvent(new window.Event('change', { bubbles: true }));
    submit(appearance);
    await waitFor(() => (document.documentElement.getAttribute('data-theme') === 'dark') === (originalTheme === 'dark'), 'theme restored');
    click($('.accent-blue'));
    assert.equal(document.documentElement.getAttribute('data-accent'), 'blue');

    const passwordForm = $('form[aria-label="Change Password"]');
    setValue(passwordForm.querySelector('[name="newPassword"]'), 'a-valid-new-password');
    setValue(passwordForm.querySelector('[name="confirmPassword"]'), 'a-different-password');
    submit(passwordForm);
    await waitFor(() => passwordForm.querySelector('[name="confirmPassword"] + .field-error:not(.hidden)') || [...passwordForm.querySelectorAll('.field-error')].some((error) => error.textContent.includes('Passwords do not match.')), 'password mismatch validation');
    assert.match(passwordForm.textContent, /Passwords do not match/);
  });

  it('"Reset progress" explains exactly what it deletes and requires password + RESET', async () => {
    const { post, get } = await import(pathToFileURL(path.join(clientDir, 'js/api.js')).href);
    await post('/assignments', { title: 'Finished thing', dueAt: new Date(Date.now() + 86400000).toISOString(), status: 'completed' });
    click(byText('.danger-zone button', 'Reset progress')); const f = await waitFor(() => $('dialog form'), 'reset dialog');
    assert.match(f.textContent, /completed assignments/); assert.match(f.textContent, /keeps your account, timetable, notes, exams/);
    setValue(f.querySelector('[name=password]'), 'a-good-long-passphrase'); setValue(f.querySelector('[name=confirm]'), 'nope'); submit(f);
    await waitFor(() => f.querySelector('.field-error:not(.hidden)'), 'confirm word error');
    assert.ok((await get('/assignments?status=completed')).meta.total >= 1, 'nothing deleted without the confirmation word');
    setValue(f.querySelector('[name=confirm]'), 'RESET'); submit(f);
    await waitFor(() => $$('.toast').some((t) => t.textContent.includes('Progress reset')), 'reset toast');
    assert.equal((await get('/assignments?status=completed')).meta.total, 0);
  });

  it('shows legal links inside the signed-in app too', async () => {
    go('#/'); await waitFor(() => $('.site-footer .legal-links'), 'app footer'); assert.equal($$('.site-footer .legal-links a').length, 4);
  });

  it('signs out and returns to the sign-in screen; private pages are then unreachable', async () => {
    click(byText('button', 'Sign out'));
    await waitFor(() => byText('h1', 'Welcome back'), 'login after logout');
    go('#/assignments');
    await waitFor(() => window.location.hash === '#/login', 'redirect to login');
    assert.equal($('nav[aria-label="Primary"]'), null);
  });
});

describe('client static checks (Content-Security-Policy friendliness)', () => {
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push(p); } })(clientDir);
  const js = files.filter((f) => f.endsWith('.js')); const html = files.filter((f) => f.endsWith('.html'));
  it('never uses innerHTML/outerHTML/insertAdjacentHTML/document.write/eval', () => {
    for (const f of js) { const t = fs.readFileSync(f, 'utf8'); assert.ok(!/\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function)/.test(t), `${path.relative(root, f)} uses unsafe API`); }
  });
  it('has no inline scripts, inline event handlers or style attributes in HTML', () => {
    for (const f of html) { const t = fs.readFileSync(f, 'utf8'); assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(t), 'inline <script>'); assert.ok(!/\son\w+=/i.test(t), 'inline handler'); assert.ok(!/\sstyle=/i.test(t), 'style attribute'); assert.ok(!/<style/i.test(t), '<style> block'); }
  });
  it('sets no style="" attributes from JS', () => {
    for (const f of js) assert.ok(!/['"]style['"]\s*:|setAttribute\(\s*['"]style/.test(fs.readFileSync(f, 'utf8')), `${path.relative(root, f)} sets a style attribute`);
  });
  it('contains no secrets, API keys or third-party hosts', () => {
    for (const f of [...js, ...html]) { const t = fs.readFileSync(f, 'utf8'); assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(t), `${path.relative(root, f)} references an external URL`); assert.ok(!/(api[_-]?key|secret|password\s*=\s*['"])/i.test(t.replace(/password/gi, '')), 'possible secret'); }
  });
});
