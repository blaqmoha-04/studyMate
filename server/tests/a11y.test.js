// Automated accessibility checks that need no browser: WCAG colour contrast for every design token pair
// in BOTH themes, plus static checks for alt text, focus visibility and keyboard-reachability rules.
// Not a substitute for manual keyboard and screen-reader testing (see docs/COMPLIANCE.md).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = fs.readFileSync(path.join(root, 'client/css/styles.css'), 'utf8');
const block = (selector) => { const m = css.match(new RegExp(`${selector.replace(/[[\]"]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m ? m[1] : ''; };
const vars = (b) => Object.fromEntries([...b.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = vars(block(':root'));
const dark = { ...light, ...vars(block(':root[data-theme="dark"]')) };

function resolve(theme, v) { let val = v.startsWith('--') ? theme[v] : v; for (let i = 0; i < 5 && val?.startsWith('var('); i++) val = theme[val.slice(4, -1).trim()]; return val; }
function rgb(hex) { const h = hex.replace('#', ''); const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255); }
const lum = (hex) => { const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground token or colour, background tokens, minimum ratio, what it is]
const SURFACES = ['--bg', '--surface', '--surface-2'];
const PAIRS = [
  ['--text', SURFACES, 4.5, 'body text'], ['--text-2', SURFACES, 4.5, 'secondary text'], ['--text-3', SURFACES, 4.5, 'hints, muted text and placeholders'],
  ['--primary', ['--bg', '--surface', '--surface-2', '--primary-soft'], 4.5, 'links and active navigation'],
  ['--primary-contrast', ['--primary', '--primary-hover'], 4.5, 'text on primary buttons'],
  ['--text', ['--primary-soft'], 4.5, 'text on selected items'],
  ['--success', ['--success-soft', '--surface'], 4.5, 'success badges'], ['--warning', ['--warning-soft', '--surface'], 4.5, 'warning badges'],
  ['--danger', ['--danger-soft', '--surface', '--bg'], 4.5, 'error text and danger icons'], ['--info', ['--info-soft', '--surface'], 4.5, 'info notes'],
  ['#ffffff', ['--danger-solid'], 4.5, 'text on solid danger buttons and the unread badge'],
  ['--avatar-fg', ['--avatar-bg'], 4.5, 'avatar initial'],
  ['--control-border', SURFACES, 3, 'input and button borders (WCAG 1.4.11)'], ['--focus', ['--bg', '--surface', '--surface-2'], 3, 'focus ring'],
  ['--c-assignment', ['--surface'], 3, 'calendar marker: assignment'], ['--c-class', ['--surface'], 3, 'calendar marker: class'],
  ['--c-exam', ['--surface'], 3, 'calendar marker: exam'], ['--c-study', ['--surface'], 3, 'calendar marker: study'],
];

describe('colour contrast (WCAG 2.1 AA) — every token pair, both themes', () => {
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    for (const [fg, bgs, min, what] of PAIRS) {
      for (const bg of bgs) {
        it(`${name}: ${what} — ${fg} on ${bg} >= ${min}`, () => {
          const f = resolve(theme, fg); const b = resolve(theme, bg);
          assert.ok(/^#[0-9a-f]{3,6}$/i.test(f ?? '') && /^#[0-9a-f]{3,6}$/i.test(b ?? ''), `token missing or not a hex colour: ${fg}=${f} ${bg}=${b}`);
          const r = ratio(f, b); assert.ok(r >= min, `${f} on ${b} is ${r.toFixed(2)}:1 (needs ${min}:1)`);
        });
      }
    }
  }
});

describe('keyboard and screen-reader rules (static)', () => {
  const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(path.join(root, 'client'));
  const src = files.filter((f) => /\.(js|html)$/.test(f)).map((f) => [f, fs.readFileSync(f, 'utf8')]);
  it('every <img> has alt text (the app currently uses none; decorative SVG icons are aria-hidden)', () => {
    for (const [f, t] of src) { for (const m of t.matchAll(/<img\b[^>]*>/gi)) assert.match(m[0], /\balt=/i, `${f}: <img> without alt`); for (const m of t.matchAll(/h\('img',\s*\{([^}]*)\}/g)) assert.match(m[1], /\balt\b/, `${f}: img without alt`); }
  });
  it('shows a visible focus indicator and never removes outlines without a replacement', () => {
    assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px/);
    // The only allowed exception: <main>, which is focused programmatically after navigation (tabindex=-1, not in the Tab order).
    for (const m of css.matchAll(/([^{}]+)\{([^}]*outline:\s*(?:none|0)\b[^}]*)\}/g)) assert.match(m[1].trim(), /(^|\s)main$/, `outline removed on: ${m[1].trim()}`);
  });
  it('off-screen mobile menu is hidden from the keyboard (no tabbing into invisible links)', () => {
    assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.sidebar\s*\{[^}]*visibility:\s*hidden/); assert.match(css, /\.app\.menu-open \.sidebar\s*\{[^}]*visibility:\s*visible/);
  });
  it('does not claim ARIA grid semantics (which would promise arrow-key navigation) on the calendar', () => {
    for (const [f, t] of src) assert.ok(!/role:\s*'(grid|gridcell)'/.test(t), `${f} uses role grid/gridcell`);
  });
  it('declares language, a skip link, reduced-motion support and a labelled landmark structure', () => {
    const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8'); assert.match(html, /<html[^>]*\blang="en"/); assert.match(html, /class="skip-link"/);
    assert.match(css, /prefers-reduced-motion/); const app = fs.readFileSync(path.join(root, 'client/js/app.js'), 'utf8'); assert.match(app, /aria-label': 'Primary'/); assert.match(app, /id: 'main'/);
  });
  it('contains no absolute marketing claims that cannot be supported', () => {
    for (const [f, t] of src) assert.ok(!/gdpr[- ]compliant|bank[- ]grade|military[- ]grade|100% (secure|safe)|unhackable|we guarantee|guaranteed (secure|safe|private|uptime|delivery)/i.test(t), `${f} makes an unsupportable claim`);
  });
});
