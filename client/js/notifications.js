// Browser notification manager, Web Audio chime sound generator, and alarm/timer scheduler.
import { bus } from './api.js';

const STORAGE_KEY = 'sm-notification-prefs';

// Default preferences
const defaultPrefs = {
  enabled: false,           // Master toggle for browser notifications
  timers: true,             // Focus timer completion & break timer
  alarms: true,             // Scheduled study session alarms & class alarms
  reminders: true,          // Assignment deadlines & exam reminders
  sound: true,              // Sound chimes
};

let cachedPrefs = null;
let swRegistration = null;

export function getNotificationPrefs() {
  if (cachedPrefs) return cachedPrefs;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cachedPrefs = { ...defaultPrefs, ...JSON.parse(raw) };
      return cachedPrefs;
    }
  } catch {
    // localStorage unavailable
  }
  cachedPrefs = { ...defaultPrefs };
  return cachedPrefs;
}

export function saveNotificationPrefs(newPrefs) {
  cachedPrefs = { ...getNotificationPrefs(), ...newPrefs };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedPrefs));
  } catch {
    // ignore
  }
  bus.dispatchEvent(new CustomEvent('notification-prefs-changed', { detail: cachedPrefs }));
  return cachedPrefs;
}

// Service worker registration
export async function initServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return swRegistration;
  } catch (err) {
    // Service worker registration can fail in insecure contexts or test environments
    return null;
  }
}

// Check notification support
export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

// Permission states: 'granted', 'denied', 'default', 'unsupported'
export function getPermissionState() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

// Request permission (must be user-initiated)
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';

  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      saveNotificationPrefs({ enabled: true });
      initServiceWorker();
    } else {
      saveNotificationPrefs({ enabled: false });
    }
    return perm;
  } catch {
    return Notification.permission;
  }
}

// Web Audio API sound generator (pure synthesis, no external MP3 dependencies)
export function playNotificationSound() {
  const prefs = getNotificationPrefs();
  if (!prefs.sound) return;

  const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Play a friendly two-tone notification chime (F5 -> A5)
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(698.46, now); // F5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.15);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.2);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);

    setTimeout(() => {
      try { ctx.close(); } catch { /* ignore */ }
    }, 1000);
  } catch {
    // AudioContext blocked or unsupported
  }
}

// Notification history deduplication (in-memory & sessionStorage)
const seenNotificationKeys = new Set();
function hasNotificationBeenSeen(dedupeKey) {
  if (!dedupeKey) return false;
  if (seenNotificationKeys.has(dedupeKey)) return true;
  try {
    const stored = sessionStorage.getItem(`sm_notif_${dedupeKey}`);
    if (stored) {
      seenNotificationKeys.add(dedupeKey);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function markNotificationSeen(dedupeKey) {
  if (!dedupeKey) return;
  seenNotificationKeys.add(dedupeKey);
  try {
    sessionStorage.setItem(`sm_notif_${dedupeKey}`, String(Date.now()));
  } catch {
    // ignore
  }
}

/**
 * Dispatch a browser notification with sound and click action.
 * @param {string} title
 * @param {object} options
 * @param {string} category 'timers' | 'alarms' | 'reminders'
 */
export async function sendBrowserNotification(title, options = {}, category = 'reminders') {
  const prefs = getNotificationPrefs();
  if (!prefs.enabled) return false;
  if (category && prefs[category] === false) return false;

  const dedupeKey = options.tag || options.dedupeKey;
  if (dedupeKey && hasNotificationBeenSeen(dedupeKey)) {
    return false;
  }

  // Play chime sound if enabled
  playNotificationSound();

  if (dedupeKey) {
    markNotificationSeen(dedupeKey);
  }

  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const notifOptions = {
    badge: '/assets/favicon.svg',
    icon: '/assets/favicon.svg',
    body: options.body || '',
    tag: dedupeKey || undefined,
    data: {
      url: options.url || '#/',
      ...options.data,
    },
  };

  // 1. Try Service Worker showNotification if active
  try {
    if (swRegistration && swRegistration.showNotification) {
      await swRegistration.showNotification(title, notifOptions);
      return true;
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, notifOptions);
        return true;
      }
    }
  } catch {
    // fall through to window Notification
  }

  // 2. Fallback to standard Notification constructor
  try {
    const notif = new Notification(title, notifOptions);
    if (options.url) {
      notif.onclick = () => {
        window.focus?.();
        if (options.url.startsWith('#')) {
          window.location.hash = options.url;
        } else {
          window.location.href = options.url;
        }
        notif.close();
      };
    }
    return true;
  } catch {
    return false;
  }
}
