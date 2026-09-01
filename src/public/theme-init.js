// Runs synchronously before the stylesheet paints, so the page never flashes
// the wrong theme. Kept as its own tiny external file (not inline) because
// the CSP here has no 'unsafe-inline' in script-src.
(function () {
  try {
    var pref = localStorage.getItem('wl-theme') || 'auto';
    var dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (!dark) document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) {
    /* localStorage/matchMedia unavailable — default dark stays */
  }
})();
