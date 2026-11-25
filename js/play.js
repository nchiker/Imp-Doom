"use strict";
/*
 * The Imp Doom player, as a module the page mounts. It runs cart/imp_doom_N.dck on TSRun, the TS2068 emulator in ../tsrun/, in a canvas.
 * Modelled on LeapG's web/main.js (same author): the machine, screen, sound, keyboard and joystick modules of tsrun/, the same frame
 * loop. The file host keeps DOOM1.SAV in localStorage (js/persist.js), so Imp Doom III's save (K) and load (L) work with no
 * file picker and survive a reload.
 *
 *   createPlayer({ screen, slot, status, joy, saveline, delsave })   the machine and its loop, no buttons; load(n) switches game
 *   mountPlayer(root, { game, start, title })                         finds the parts of a player under `root` by data-role, wires the
 *                                                                     buttons, the game tabs, the key help and the deep link
 *
 * One machine, one canvas, one WebGL context and one sound context are made once. Switching games (load(n)) stops the frame loop's
 * stepping, lets go of every key, swaps the cartridge (insertDock), clears RAM like a cold start and resets the CPU, the AY chip and
 * the ports, so the old game cannot leave anything running or sounding.
 */
import {
  createMachine, setHomeRom, setExRom, resetMachine, runFrame, enableSound, setSoundRate, takeAudio,
  cpuHz, tStatesPerFrame, homeRomSize, exRomSize, insertDock,
} from '../tsrun/machine.js';
import { initScreen, resizeScreen, drawScreen } from '../tsrun/screen.js';
import {
  initSound, resumeSound, soundWantsFrame, soundIsRunning, setSoundNeedCallback, setSoundStateCallback, pushSound,
} from '../tsrun/sound.js';
import { initKeyboard, handleKeyDown, handleKeyUp, handleBlur } from '../tsrun/keyboard.js';
import { initJoysticks, pollJoysticks, padLabel } from '../tsrun/joystick.js';
import { createPersistentHost } from './persist.js';

export const GAMES = {
  1: { name: 'Imp Doom', file: 'cart/imp_doom_1.dck', poster: 'img/imp1_title.png', save: false, page: 'imp-doom-1.html' },
  2: { name: 'Imp Doom II', file: 'cart/imp_doom_2.dck', poster: 'img/imp2_title.png', save: false, page: 'imp-doom-2.html' },
  3: { name: 'Imp Doom III', file: 'cart/imp_doom_3.dck', poster: 'img/imp3_title.png', save: true, page: 'imp-doom-3.html' },
};
const SAVE = 'DOOM1.SAV';
const TSRUN = new URL('../tsrun/', import.meta.url);
const SITE = new URL('../', import.meta.url);
const FPS = cpuHz / tStatesPerFrame, FRAME_MS = 1000 / FPS;

async function fetchBytes(url, size) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  if (size !== undefined && b.length !== size) throw new Error(`${url}: ${b.length} bytes, expected ${size}`);
  return b;
}

/** Game number from a location: ?game=N or #play=N (also #game=N); 0 when there is none. */
export function gameFromLocation(loc = location) {
  const q = new URLSearchParams(loc.search).get('game');
  const h = /^#(?:play|game)=([123])$/.exec(loc.hash || '');
  const n = Number(q ?? (h ? h[1] : 0));
  return GAMES[n] ? n : 0;
}

export function createPlayer(els) {
  const { screen, slot } = els;
  const keyMatrix = new Uint8Array(8).fill(0x1F);
  const joystick = new Uint8Array(2).fill(0xFF);
  initJoysticks(joystick);
  const padIds = ['', ''];
  const m = createMachine(keyMatrix, joystick);
  const kbd = initKeyboard(screen, keyMatrix);
  const app = {
    m, gfx: null, sfx: null, frames: 0, paused: false, hidden: false, lastNow: 0, carryMs: 0, error: '',
    game: 0, booted: false, switching: false, token: 0,
  };
  const listeners = { game: [], pause: [], save: [] };
  const emit = (k, ...a) => listeners[k].forEach((f) => f(...a));
  const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };

  // ── Saved game (localStorage, key 'impdoom:DOOM1.SAV') ──
  let store = null;
  try { store = window.localStorage; } catch { store = null; }
  const ph = createPersistentHost(store, { onChange: showSave });
  app.persist = ph;
  m.host = ph.host;
  function showSave() {
    const g = GAMES[app.game];
    if (!els.saveline) return;
    if (!g) { els.saveline.textContent = 'Saved game: -'; if (els.delsave) els.delsave.hidden = true; return; }
    if (!g.save) {
      els.saveline.textContent = `Saved game: not used (${g.name} has no save key; Imp Doom III does)`;
      if (els.delsave) els.delsave.hidden = true;
      return;
    }
    const has = ph.has(SAVE);
    els.saveline.textContent = `Saved game: ${has ? 'yes' : 'no'}` + (ph.state.available ? '' : ` (${ph.state.error})`);
    if (els.delsave) els.delsave.hidden = !has;
    emit('save', has);
  }
  if (els.delsave) els.delsave.onclick = () => { ph.remove(SAVE); focus(); };

  function focus() { screen.focus({ preventScroll: true }); }

  // ── Frame loop (after LeapG web/main.js) ──
  const running = () => !app.paused && !app.hidden && !app.switching && app.booted;
  function step() {
    if (!running()) return;
    enableSound(m, app.sfx !== null && soundIsRunning(app.sfx));
    runFrame(m);
    app.frames++;
    const chunk = takeAudio(m);
    if (chunk.n > 0 && app.sfx && soundIsRunning(app.sfx)) pushSound(app.sfx, chunk);
  }
  function onFrame(now) {
    requestAnimationFrame(onFrame);
    if (!running()) { app.lastNow = 0; }
    else {
      if (app.lastNow === 0) { app.lastNow = now; app.carryMs = FRAME_MS; }
      app.carryMs += Math.min(now - app.lastNow, 80);      // a backgrounded tab does not fast-forward on return
      app.lastNow = now;
      for (let ran = 0; app.carryMs >= FRAME_MS && ran < 4; ran++) { step(); app.carryMs -= FRAME_MS; }
    }
    pollJoysticks(joystick, padIds);
    setText(els.joy, padIds[0] ? `joystick: ${padLabel(padIds[0])}` : 'joystick: no gamepad');
    if (app.gfx && app.booted) drawScreen(app.gfx, m.pixels);
    if (els.status) {
      setText(els.status, app.error || (app.switching ? 'loading' : app.paused ? 'paused' : (app.sfx && soundIsRunning(app.sfx) ? '' : 'click the screen for sound')));
    }
  }
  function fillSoundQueue() {
    if (!app.sfx || !soundIsRunning(app.sfx) || !running()) return;
    for (let ran = 0; ran < 4 && soundWantsFrame(app.sfx); ran++) {
      step();
      app.carryMs = Math.max(app.carryMs - FRAME_MS, -4 * FRAME_MS);
    }
  }

  // ── Input ──
  screen.addEventListener('keydown', (e) => { if (app.sfx) resumeSound(app.sfx); handleKeyDown(kbd, e); });
  screen.addEventListener('keyup', (e) => handleKeyUp(kbd, e));
  screen.addEventListener('blur', () => handleBlur(kbd));
  screen.addEventListener('pointerdown', () => { focus(); if (app.sfx) resumeSound(app.sfx); });
  document.addEventListener('fullscreenchange', () => { if (app.gfx) resizeScreen(app.gfx); });

  // ── Machine set-up (once) ──
  let ready = null;
  function boot() {
    if (ready) return ready;
    ready = (async () => {
      const [home, exrom, vert, frag] = await Promise.all([
        fetchBytes(new URL('roms/ts2068-0.rom', TSRUN), homeRomSize),
        fetchBytes(new URL('roms/ts2068-1.rom', TSRUN), exRomSize),
        fetch(new URL('screen.vert.glsl', TSRUN)).then((r) => r.text()),
        fetch(new URL('screen.frag.glsl', TSRUN)).then((r) => r.text()),
      ]);
      const err = setHomeRom(m, home) ?? setExRom(m, exrom);
      if (err) throw new Error(err);
      await new Promise((resolve) => {
        initScreen(screen, { vert, frag }, (e, gfx) => {
          if (e !== null || gfx === null) { app.error = e ?? 'No graphics context (WebGL2 is needed)'; resolve(); return; }
          app.gfx = gfx;
          resizeScreen(gfx);
          resolve();
        });
      });
      new ResizeObserver(() => { if (app.gfx) resizeScreen(app.gfx); }).observe(slot);
      initSound(FPS, (e, sfx) => {
        if (e !== null || sfx === null) { console.warn('no sound:', e); return; }
        app.sfx = sfx;
        setSoundNeedCallback(sfx, fillSoundQueue);
        setSoundRate(m, sfx.context.sampleRate);
        setSoundStateCallback(sfx, (r) => enableSound(m, r));
        enableSound(m, soundIsRunning(sfx));
      });
      requestAnimationFrame(onFrame);
    })();
    return ready;
  }

  const carts = new Map();
  async function cart(n) {
    if (!carts.has(n)) carts.set(n, fetchBytes(new URL(GAMES[n].file, SITE)).catch((e) => { carts.delete(n); throw e; }));
    return carts.get(n);
  }

  /** Cold-start cartridge n: stop the old game, swap, reset. Safe to call again before the last call finished (the last wins). */
  async function load(n) {
    if (!GAMES[n]) throw new Error(`no game ${n}`);
    const tok = ++app.token;
    app.switching = true;                                  // the loop stops stepping the old game
    app.error = '';
    try {
      const [dck] = await Promise.all([cart(n), boot()]);
      if (tok !== app.token) return;                       // a newer load took over
      if (app.error) throw new Error(app.error);
      handleBlur(kbd);                                     // let go of every key
      keyMatrix.fill(0x1F);
      joystick.fill(0xFF);
      m.ram.fill(0);                                       // cold RAM, as a power-on start
      const derr = insertDock(m, dck);
      if (derr !== null) throw new Error(`Not a cartridge the TS2068 can take: ${derr}`);
      resetMachine(m);                                     // CPU, ports, border, AY chip silenced
      app.frames = 0; app.game = n; app.booted = true; app.paused = false; app.lastNow = 0;
      emit('pause', false);
      emit('game', n, GAMES[n]);
      showSave();
    } catch (e) {
      if (tok === app.token) { app.error = String(e.message ?? e); }
      throw e;
    } finally {
      if (tok === app.token) app.switching = false;
    }
  }

  function reset() {
    if (!app.booted) return;
    joystick.fill(0xFF); keyMatrix.fill(0x1F); handleBlur(kbd);
    resetMachine(m);
    app.frames = 0;
  }
  function setPaused(p) { app.paused = p; emit('pause', p); }
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (slot.requestFullscreen) slot.requestFullscreen().then(focus).catch(() => {});
  }
  return {
    app, load, reset, focus, fullscreen, setPaused, showSave,
    togglePause() { setPaused(!app.paused); },
    setVisible(v) { app.hidden = !v; },
    resume() { if (app.sfx) resumeSound(app.sfx); },
    on(k, f) { listeners[k].push(f); },
  };
}

/**
 * Wire a player into the page. Parts are found under `root` by data-role: screen, slot, status, joy, saveline, delsave, reset, pause, full,
 * poster (a "press to play" cover, hidden once a game runs), about (a link to the game's page), gname, keys3 (shown for games with a
 * save key), and [data-game] tabs (buttons or links whose data-game is 1, 2 or 3).
 * opts.game: initial game (default: the deep link, else 3); opts.start: 'now' boots at once, 'click' waits for the poster, a tab or play();
 * opts.title: set document.title to "Play <name>" (the play.html page); opts.url(n): the address (relative) to show when a tab is chosen, set with history.replaceState.
 */
export function mountPlayer(root, opts = {}) {
  const $ = (r) => root.querySelector(`[data-role="${r}"]`);
  const tabs = [...root.querySelectorAll('[data-game]')];
  const player = createPlayer({
    screen: $('screen'), slot: $('slot'), status: $('status'), joy: $('joy'), saveline: $('saveline'), delsave: $('delsave'),
  });
  window.impDoom = player.app;                             // for tests and the console
  window.impDoomPlayer = player;
  const link = gameFromLocation();
  let want = opts.game || link || 3;
  const sync = (n) => {
    const g = GAMES[n];
    tabs.forEach((t) => {
      const on = Number(t.dataset.game) === n;
      t.classList.toggle('current', on);
      t.setAttribute('aria-selected', String(on));
      if (t.tagName === 'BUTTON') t.tabIndex = on ? 0 : -1;
    });
    if ($('gname')) $('gname').textContent = g.name;
    if ($('about')) { $('about').href = g.page; $('about').textContent = `About ${g.name}`; }
    root.querySelectorAll('[data-for-game]').forEach((el) => { el.hidden = !el.dataset.forGame.split(' ').includes(String(n)); });
    if ($('keys3')) $('keys3').hidden = !g.save;
    if ($('poster')) $('poster').style.backgroundImage = `url(${g.poster})`;
    if (opts.title) document.title = `Play ${g.name}`;
  };
  sync(want);
  player.on('game', (n) => sync(n));
  player.on('pause', (p) => { if ($('pause')) $('pause').textContent = p ? 'Run' : 'Pause'; });
  player.showSave();
  const select = async (n, { userStart = true } = {}) => {
    want = n;
    sync(n);
    if ($('poster')) $('poster').hidden = true;
    player.resume();
    try { await player.load(n); } catch (e) { if (want === n) console.warn('load failed:', e); }
    if (want === n && userStart) player.focus();
  };
  tabs.forEach((t) => t.addEventListener('click', (e) => {
    e.preventDefault();
    const n = Number(t.dataset.game);
    if (opts.url) { try { history.replaceState(null, '', opts.url(n)); } catch { /* sandboxed */ } }
    select(n);
  }));
  if ($('reset')) $('reset').onclick = () => { player.reset(); player.focus(); };
  if ($('pause')) $('pause').onclick = () => { player.togglePause(); player.focus(); };
  if ($('full')) $('full').onclick = () => player.fullscreen();
  if ($('poster')) $('poster').addEventListener('click', () => select(want));
  // run only while the player is on screen (the page has much else to read)
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((es) => player.setVisible(es[es.length - 1].isIntersecting), { threshold: 0.1 }).observe($('slot'));
  }
  const api = { player, select, play: (n) => select(n || want), current: () => want };
  if (opts.start === 'now' || link) select(want, { userStart: opts.start === 'now' });
  window.addEventListener('hashchange', () => { const n = gameFromLocation(); if (n) select(n); });
  return api;
}
