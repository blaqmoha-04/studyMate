// Runs before first paint (blocking, external so it passes the CSP) to avoid a flash of the wrong theme.
(function () {
  try {
    var t = localStorage.getItem('sm-theme') || 'system';
    if (['light', 'dark', 'system'].indexOf(t) === -1) t = 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var accent = localStorage.getItem('sm-accent');
    if (['blue', 'purple', 'green', 'cyan', 'orange'].indexOf(accent) !== -1) {
      document.documentElement.setAttribute('data-accent', accent);
    }
  } catch (e) { /* storage unavailable: default theme */ }
})();
