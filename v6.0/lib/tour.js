// tour.js — the first-run walkthrough: dims the page, spotlights one thing at
// a time, and says what it's for. startTour(steps, onDone).

const TOUR_STEPS = {
  status: { target: '[data-tour="status"]', title: 'Between you and the fun stuff',
    text: 'This counts what’s left today. Get it to zero and everything opens on its own.' },
  calendar: { target: '[data-tour="calendar"]', title: 'Your month',
    text: 'Pick any day to see it or plan ahead. The little dots are tasks.' },
  list: { target: '[data-tour="list"]', title: 'The day',
    text: 'Tick things off here. Hit play to start a timer. Countdowns tick themselves off when they’re done.' },
  add: { target: '[data-tour="add"]', title: 'Add things',
    text: 'Type a task and press Enter. Add “friday” or “10/3” to plan it for that day, and “45m” for how long it takes. Switch to Habit for things that repeat.' },
  week: { target: '[data-tour="week"]', title: 'Your week of habits',
    text: 'Each habit day by day, and how much of the week you’ve done. You can tick off earlier days here too.' },
  notes: { target: '[data-tour="notes"]', title: 'Sticky notes',
    text: 'Jot anything down. Your notes show up around the lock screen too.' },
  settings: { target: '[data-tour="settings"]', title: 'Bedtime and the rest',
    text: 'Bedtime, which sites wait for your list, your Google Calendar and your notes all live in here.' },
};
const POPUP_TOUR = ['status', 'calendar', 'list', 'add', 'settings'].map(k => TOUR_STEPS[k]);
// The full planner has two more parts: this week's habits and the sticky notes.
const PAGE_TOUR = ['status', 'calendar', 'list', 'add', 'week', 'notes', 'settings'].map(k => TOUR_STEPS[k]);

function startTour(steps, onDone) {
  let i = 0;
  const before = document.activeElement;
  const spot = h('div', { class: 'tour-spot', 'aria-hidden': 'true' });
  const count = h('span', { class: 'tour-count num' });
  const title = h('h2', { class: 'tour-title', id: 'tour-title' });
  const text = h('p', { class: 'tour-text' });
  const back = h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => go(i - 1) }, 'Back');
  const next = h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => go(i + 1) });
  const skip = h('button', { type: 'button', class: 'tour-skip', onclick: () => end() }, 'Skip');
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' },
    h('div', { class: 'tour-top' }, count, skip), title, text, h('div', { class: 'tour-row' }, back, next));
  const layer = h('div', { class: 'tour' }, spot, card);
  document.body.append(layer);

  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); go(i - 1); }
  };
  document.addEventListener('keydown', key, true);
  addEventListener('resize', place);
  addEventListener('scroll', place, true);          // any scrolling part of the page moves the spotlight's target

  function place() {
    const step = steps[i];
    const el = document.querySelector(step.target);
    if (!el) return;
    const r = el.getBoundingClientRect(), pad = 6;
    Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const c = card.getBoundingClientRect();
    const W = innerWidth, H = innerHeight, gap = 14;
    let x, y;
    if (r.bottom + gap + c.height < H) { y = r.bottom + gap; x = r.left; }             // below
    else if (r.top - gap - c.height > 0) { y = r.top - gap - c.height; x = r.left; }   // above
    else if (r.right + gap + c.width < W) { x = r.right + gap; y = r.top; }            // right
    else { x = r.left - gap - c.width; y = r.top; }                                    // left
    x = Math.max(12, Math.min(W - c.width - 12, x));
    y = Math.max(12, Math.min(H - c.height - 12, y));
    card.style.left = x + 'px'; card.style.top = y + 'px';
  }

  function go(n) {
    if (n >= steps.length) return end();
    i = Math.max(0, n);
    const step = steps[i];
    count.textContent = `${i + 1} of ${steps.length}`;
    title.textContent = step.title;
    text.textContent = step.text;
    back.hidden = i === 0;
    next.textContent = i === steps.length - 1 ? 'Got it' : 'Next';
    document.querySelector(step.target)?.scrollIntoView({ block: 'nearest' });   // the full planner can have it below the fold
    requestAnimationFrame(place);
    next.focus();
  }

  function end() {
    document.removeEventListener('keydown', key, true);
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    layer.remove();
    if (before && before.focus) before.focus();
    if (onDone) onDone();
  }

  go(0);
}
