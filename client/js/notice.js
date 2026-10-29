import { h } from './dom.js';

// An informational notice, deliberately NOT a consent form: StudyMate sets one strictly-necessary cookie (sign-in)
// and stores display preferences on the device. It uses no analytics, advertising or tracking, so there is nothing
// to opt in or out of, and offering fake "choices" would be misleading. If optional cookies are ever added, replace this
// with a real consent mechanism (equal-prominence Accept/Reject, nothing set before consent).
export function showCookieNotice() {
  try { if (localStorage.getItem('sm-notice-ack')) return; } catch { /* storage unavailable: show the notice every time */ }
  const el = h('section', { class: 'notice', role: 'region', 'aria-label': 'Cookie notice' },
    h('p', {}, 'StudyMate uses one essential cookie to keep you signed in, and saves your display preferences (theme, sidebar) on this device. There are no analytics, advertising or tracking cookies, so there is nothing to opt in or out of. ',
      h('a', { href: '#/cookies' }, 'Cookie policy')),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { try { localStorage.setItem('sm-notice-ack', '1'); } catch { /* ignore */ } el.remove(); } }, 'OK, got it'));
  document.body.append(el);
}
