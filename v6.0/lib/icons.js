// icons.js — one icon set for the whole extension. 20×20 grid, 1.7 stroke,
// round ends. icon('moon', 18) → an <svg> element.

const NY_ICONS = {
  check:    '<path d="M5 10.4l3.3 3.3L15.2 6.8"/>',
  x:        '<path d="M6 6l8 8M14 6l-8 8"/>',
  plus:     '<path d="M10 4.5v11M4.5 10h11"/>',
  play:     '<path d="M7 5.3v9.4a.7.7 0 0 0 1.05.6l7.5-4.7a.7.7 0 0 0 0-1.2l-7.5-4.7A.7.7 0 0 0 7 5.3z"/>',
  pause:    '<path d="M7.5 5.5v9M12.5 5.5v9"/>',
  stop:     '<rect x="5.5" y="5.5" width="9" height="9" rx="2"/>',
  left:     '<path d="M12 5l-5 5 5 5"/>',
  up:       '<path d="M10 15.5v-11M5.5 9L10 4.5 14.5 9"/>',
  right:    '<path d="M8 5l5 5-5 5"/>',
  down:     '<path d="M5.5 8l4.5 4.5L14.5 8"/>',
  settings: '<path d="M3.5 6.5h6M13.5 6.5h3M3.5 13.5h2M9.5 13.5h7"/><circle cx="11.5" cy="6.5" r="2"/><circle cx="7.5" cy="13.5" r="2"/>',
  expand:   '<path d="M11.5 3.5h5v5M16.5 3.5L10 10M14.5 12v3.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H8"/>',
  calendar: '<rect x="3.5" y="4.5" width="13" height="12" rx="2.5"/><path d="M3.5 8.5h13M7 3v3M13 3v3"/>',
  moon:     '<path d="M16.2 12.4A6.6 6.6 0 0 1 7.6 3.8a6.6 6.6 0 1 0 8.6 8.6z"/>',
  sun:      '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.8v1.6M10 15.6v1.6M2.8 10h1.6M15.6 10h1.6M4.9 4.9l1.1 1.1M14 14l1.1 1.1M4.9 15.1L6 14M14 6l1.1-1.1"/>',
  lock:     '<rect x="4.5" y="9" width="11" height="8" rx="2.2"/><path d="M7 9V6.8a3 3 0 0 1 6 0V9"/>',
  unlock:   '<rect x="4.5" y="9" width="11" height="8" rx="2.2"/><path d="M7 9V6.8a3 3 0 0 1 5.8-1.1"/>',
  timer:    '<circle cx="10" cy="11" r="6"/><path d="M10 8v3.2l2 1.3M8 3h4"/>',
  trash:    '<path d="M4.5 6h11M8.2 6V4.6h3.6V6M6 6l.7 9.3a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6"/>',
  pencil:   '<path d="M12.8 4.6l2.6 2.6-8.1 8.1-3.3.7.7-3.3z"/>',
  more:     '<circle cx="5" cy="10" r=".9" fill="currentColor"/><circle cx="10" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/>',
  repeat:   '<path d="M4 9V8.2A2.7 2.7 0 0 1 6.7 5.5H15M13 3.5l2 2-2 2M16 11v.8a2.7 2.7 0 0 1-2.7 2.7H5M7 16.5l-2-2 2-2"/>',
  note:     '<path d="M16 11.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6.5z"/><path d="M11.5 16v-3.5a1 1 0 0 1 1-1H16"/>',
  sync:     '<path d="M15.6 8.2A6 6 0 0 0 4.8 6.6M4.4 3.8v3h3M4.4 11.8a6 6 0 0 0 10.8 1.6M15.6 16.2v-3h-3"/>',
  link:     '<path d="M8.6 11.4a3 3 0 0 0 4.2 0l2.4-2.4a3 3 0 0 0-4.2-4.2l-.9.9M11.4 8.6a3 3 0 0 0-4.2 0L4.8 11a3 3 0 0 0 4.2 4.2l.9-.9"/>',
  download: '<path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9M4 16.5h12"/>',
  upload:   '<path d="M10 12.5v-9M6.5 7L10 3.5 13.5 7M4 16.5h12"/>',
  help:     '<circle cx="10" cy="10" r="7"/><path d="M8.2 8a1.9 1.9 0 0 1 3.7.6c0 1.3-1.9 1.6-1.9 2.9M10 14h.01"/>',
  tag:      '<path d="M3.5 4.5v4.7a1 1 0 0 0 .3.7l6.3 6.3a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4L9.8 3.8a1 1 0 0 0-.7-.3H4.5a1 1 0 0 0-1 1z"/><circle cx="7" cy="7" r="1"/>',
  book:     '<path d="M4.5 15V5.5a1.5 1.5 0 0 1 1.5-1.5h9.5v10.5H6a1.5 1.5 0 0 0-1.5 1.5zm0 0A1.5 1.5 0 0 0 6 16.5h9.5"/>',
  bell:     '<path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.2 1.5H4.3zM8.5 17h3"/>',
  focus:    '<path d="M4 8V5a1 1 0 0 1 1-1h3M12 4h3a1 1 0 0 1 1 1v3M16 12v3a1 1 0 0 1-1 1h-3M8 16H5a1 1 0 0 1-1-1v-3"/>',
  move:     '<rect x="3.5" y="4.5" width="13" height="12" rx="2.5"/><path d="M3.5 8.5h13M8 12.5h4.5M11 11l1.5 1.5L11 14"/>',
  grip:     '<circle cx="7.5" cy="5.5" r=".9" fill="currentColor"/><circle cx="12.5" cy="5.5" r=".9" fill="currentColor"/><circle cx="7.5" cy="10" r=".9" fill="currentColor"/><circle cx="12.5" cy="10" r=".9" fill="currentColor"/><circle cx="7.5" cy="14.5" r=".9" fill="currentColor"/><circle cx="12.5" cy="14.5" r=".9" fill="currentColor"/>',
  hourglass:'<path d="M5.5 3.5h9M5.5 16.5h9M6.8 3.5c0 3.3 3.2 4.3 3.2 6.5s-3.2 3.2-3.2 6.5M13.2 3.5c0 3.3-3.2 4.3-3.2 6.5s3.2 3.2 3.2 6.5"/>',
  list:     '<path d="M8 6h8M8 10h8M8 14h8"/><circle cx="4.6" cy="6" r=".9" fill="currentColor"/><circle cx="4.6" cy="10" r=".9" fill="currentColor"/><circle cx="4.6" cy="14" r=".9" fill="currentColor"/>',
  palette:  '<path d="M10 3.5a6.5 6.5 0 1 0 0 13c.9 0 1.4-.6 1.4-1.3 0-.9-.8-1.2-.8-2 0-.7.6-1.2 1.3-1.2h1.6a3 3 0 0 0 3-3C16.5 6 13.6 3.5 10 3.5z"/><circle cx="6.8" cy="9.6" r=".8" fill="currentColor"/><circle cx="9" cy="6.8" r=".8" fill="currentColor"/><circle cx="12.4" cy="7.2" r=".8" fill="currentColor"/>',
  info:     '<circle cx="10" cy="10" r="7"/><path d="M10 9v4.5M10 6.5h.01"/>',
  puzzle:   '<path d="M8.2 5.5V5a1.8 1.8 0 0 1 3.6 0v.5H15a.5.5 0 0 1 .5.5v3.2H15a1.8 1.8 0 0 0 0 3.6h.5V16a.5.5 0 0 1-.5.5h-3.2V16a1.8 1.8 0 0 0-3.6 0v.5H5a.5.5 0 0 1-.5-.5v-3.2H5a1.8 1.8 0 0 0 0-3.6h-.5V6a.5.5 0 0 1 .5-.5z"/>',
  pin:      '<path d="M7.5 3.5h5M8.7 3.5v4L6 10.8h8l-2.7-3.3v-4M10 10.8v5.7"/>',
  video:    '<rect x="3" y="5" width="14" height="10" rx="3"/><path d="M8.6 7.9v4.2a.4.4 0 0 0 .6.35l3.3-2.1a.4.4 0 0 0 0-.7l-3.3-2.1a.4.4 0 0 0-.6.35z"/>',
};

function icon(name, size = 18, extra = '') {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="icon ${extra}" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NY_ICONS[name] || ''}</svg>`;
  return wrap.firstChild;
}

// The logo: an hourglass on a lilac tile, sand still in the top half.
function logoSvg(size = 26) {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="9" style="fill: var(--accent-solid, #ddd1fb)"/>
    <path d="M10.5 9.8h11l-5.5 6.2z" fill="#f7d772"/>
    <path d="M16 19.2l3.6 3.7h-7.2z" fill="#f7d772"/>
    <path d="M9.5 7.5h13M9.5 24.5h13M11.2 7.5c0 4.6 4.8 6 4.8 8.5s-4.8 3.9-4.8 8.5M20.8 7.5c0 4.6-4.8 6-4.8 8.5s4.8 3.9 4.8 8.5"
      fill="none" stroke="#2a2745" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  return wrap.firstChild;
}
