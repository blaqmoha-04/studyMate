// All dates are displayed and entered in the user's chosen time zone (Settings), matching the server's calculations.
import { tz } from './store.js';

const dtf = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: tz(), ...opts });
export const fmtDate = (iso) => dtf({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
export const fmtTime = (iso) => dtf({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const fmtDateTime = (iso) => dtf({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const fmtShort = (iso) => dtf({ day: 'numeric', month: 'short' }).format(new Date(iso));

function parts(date, timeZone) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date)) p[x.type] = x.value;
  return p;
}
// 'YYYY-MM-DD' of an instant, in the user's zone.
export const dayKey = (iso) => { const p = parts(new Date(iso), tz()); return `${p.year}-${p.month}-${p.day}`; };
export const todayKey = () => dayKey(new Date().toISOString());
// ISO instant -> value for <input type="datetime-local"> in the user's zone.
export const isoToInput = (iso) => { const p = parts(new Date(iso), tz()); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
// <input type="datetime-local"> value (interpreted in the user's zone) -> ISO instant with 'Z'.
export function inputToIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const [y, mo, d, hh, mm] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, hh, mm);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) { // two passes handle DST edges
    const p = parts(new Date(guess), tz());
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess += asUtc - shown;
  }
  return new Date(guess).toISOString();
}
export const defaultInput = (hoursAhead = 24) => isoToInput(new Date(Date.now() + hoursAhead * 3600000).toISOString());

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`; if (m) return `${m}m`; return `${s}s`;
}
export const fmtClock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0'); return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
};
export function countdown(seconds) {
  if (seconds <= 0) return 'now';
  const d = Math.floor(seconds / 86400); const h = Math.floor((seconds % 86400) / 3600); const m = Math.floor((seconds % 3600) / 60);
  if (d >= 1) return `${d}d ${h}h`; if (h >= 1) return `${h}h ${m}m`; return `${Math.max(1, m)}m`;
}
export function relativeDue(iso) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  return diff < 0 ? `${countdown(-diff)} ago` : `in ${countdown(diff)}`;
}
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAYS_SHORT = DAYS.map((d) => d.slice(0, 3));
// Add n days to a 'YYYY-MM-DD' string (pure calendar arithmetic, no zone issues).
export function addDays(key, n) { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const dowOf = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();
