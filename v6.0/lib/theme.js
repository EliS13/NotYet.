// theme.js — runs in <head> before the page paints, so a page opens in the
// right theme instead of flashing the other one. Settings are cached in
// localStorage because chrome.storage can't be read synchronously.
(() => {
  try {
    const t = localStorage.getItem('ny-theme'), a = localStorage.getItem('ny-accent');
    if (t && t !== 'system') document.documentElement.dataset.theme = t;
    if (a && a !== 'lilac') document.documentElement.dataset.accent = a;
  } catch {}
})();
