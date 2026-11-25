"use strict";
/* The main page: mounts the embedded player (js/play.js), makes every "Play" link select a game in it, and runs the hero's picture carousel. */
import { mountPlayer, gameFromLocation } from './play.js';

const root = document.getElementById('play');
const DESC = {
  1: 'Imp Doom: four hand-built levels, yellow imps, the same every game. The first game, frozen as it was.',
  2: 'Imp Doom II: the same four levels, but a seed moves the imps and items about each new game. Blue title border, new tune.',
  3: 'Imp Doom III: generated levels up to level 99, green imps, a dark tune, and K / L to save and load. The final build.',
};
const gdesc = document.querySelector('[data-role="gdesc"]');
const api = mountPlayer(root, { start: 'click', url: (n) => `#play=${n}` });
const showDesc = (n) => { if (gdesc) gdesc.textContent = DESC[n]; };
showDesc(api.current());
api.player.on('game', showDesc);
document.querySelectorAll('[data-game]').forEach((t) => t.addEventListener('click', () => showDesc(Number(t.dataset.game))));

const toPlayer = () => root.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
// every <a data-playlink href="#play=N"> (hero, cards, carousel) selects game N in the player, scrolls to it and starts it
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-playlink]');
  if (!a) return;
  const n = Number(/#play=(\d)/.exec(a.getAttribute('href'))?.[1]);
  if (!n) return;
  e.preventDefault();
  try { history.replaceState(null, '', `#play=${n}`); } catch { /* sandboxed */ }
  showDesc(n);
  toPlayer();
  api.select(n);
});
if (gameFromLocation()) setTimeout(toPlayer, 50);
window.addEventListener('hashchange', () => { if (gameFromLocation()) toPlayer(); });

// ── hero carousel (after the Leap Desktop page) ──
(function () {
  const G = [
    ['img/imp1_title.png', 1, 'Imp Doom', 'four hand-built levels, yellow imps', 'The Imp Doom title screen: a yellow imp, the words IMP DOOM and PRESS FIRE, on a black border'],
    ['img/imp2_title.png', 2, 'Imp Doom II', 'the same levels, remixed by a seed', 'The Imp Doom II title screen: a yellow imp, the words IMP DOOM II and PRESS FIRE, on a blue border'],
    ['img/imp3_title.png', 3, 'Imp Doom III', 'generated levels, green imps, save and load', 'The Imp Doom III title screen: a green imp, the words IMP DOOM III and PRESS FIRE, on a green border'],
    ['img/imp3_imps.png', 3, 'Imp Doom III', 'two green imps close in', 'Imp Doom III: two green imps with red eyes and white horns in a corridor'],
    ['img/imp3_level1.png', 3, 'Imp Doom III', 'a generated level: a red brick corridor', 'Imp Doom III level 1: a red brick corridor, the pistol and the status bar'],
    ['img/imp2_win.png', 2, 'Imp Doom II', 'the IMPS SLAIN banner after level 4', 'Imp Doom II: the IMPS SLAIN banner'],
  ];
  const img = document.getElementById('rot-img'), nameEl = document.getElementById('rot-name'), about = document.getElementById('rot-about'),
    dots = document.getElementById('rot-dots'), link = document.getElementById('rot-link'), play = document.getElementById('rot-play');
  let cur = 2, timer = null, held = false;
  const buttons = G.map((g, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'tab'); b.title = `${g[2]}: ${g[3]}`; b.setAttribute('aria-label', `${g[2]}: ${g[3]}`);
    b.addEventListener('click', () => { show(i); restart(); });
    dots.appendChild(b);
    return b;
  });
  function show(i) {
    cur = (i + G.length) % G.length;
    const g = G[cur];
    img.src = g[0]; img.alt = g[4];
    nameEl.textContent = g[2]; about.textContent = g[3];
    link.setAttribute('href', `#play=${g[1]}`); play.setAttribute('href', `#play=${g[1]}`);
    play.textContent = `▶ Play ${g[2]}`;
    buttons.forEach((b, k) => b.setAttribute('aria-selected', String(k === cur)));
  }
  function restart() {
    clearInterval(timer);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => { if (!held && !document.hidden) show(cur + 1); }, 5000);
  }
  const box = document.querySelector('.rot');
  box.addEventListener('mouseenter', () => { held = true; });
  box.addEventListener('mouseleave', () => { held = false; });
  G.forEach((g) => { new Image().src = g[0]; });
  show(cur); restart();
})();
