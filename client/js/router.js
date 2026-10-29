// Hash router (#/path?query). The hash is never sent to the server, so reset tokens in it stay out of logs and Referer headers.
let routes = []; let leaveGuard = null; let current = ''; let reverting = false; let onChange = () => {};

export function configure(table, handler) { routes = table; onChange = handler; }
export const setLeaveGuard = (fn) => { leaveGuard = fn; };
export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(query)) };
}
export const navigate = (path) => { window.location.hash = `#${path}`; };
// replace() avoids adding a history entry (useful for auth redirects) and fires
// onChange even when the target hash is already the current one.
// We always update current and call onChange ourselves because location.replace()
// does not reliably fire a hashchange event in all browsers.
export function replace(path) {
  const target = `#${path}`;
  current = target;
  if (window.location.hash !== target) window.location.replace(target);
  onChange(resolve());
}

export function resolve() {
  const { path, query } = parseHash();
  for (const r of routes) {
    const m = r.pattern.exec(path);
    if (m) return { route: r, params: m.groups ?? {}, query, path };
  }
  return { route: routes.find((r) => r.notFound), params: {}, query, path };
}

export function start() {
  window.addEventListener('hashchange', () => {
    if (reverting) { reverting = false; return; }
    if (leaveGuard && !leaveGuard()) { reverting = true; window.location.hash = current; return; }
    current = window.location.hash; onChange(resolve());
  });
  current = window.location.hash; onChange(resolve());
}
export const refresh = () => { current = window.location.hash; onChange(resolve()); };
