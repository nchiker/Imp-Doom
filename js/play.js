"use strict";
/*
 * The Imp Doom player: runs cart/imp_doom_N.dck (play.html?game=1|2|3) on TSRun, the TS2068 emulator in ../tsrun/, in a canvas.
 * Modelled on LeapG's web/main.js (same author): the machine, screen, sound, keyboard and joystick modules of tsrun/, the same frame
 * loop. The file host keeps DOOM1.SAV in localStorage (js/persist.js), so Imp Doom III's save (K) and load (L) work with no
 * file picker and survive a reload.
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

const GAMES = {
  1: { name: 'Imp Doom', file: 'cart/imp_doom_1.dck', save: false, page: 'imp-doom-1.html' },
  2: { name: 'Imp Doom II', file: 'cart/imp_doom_2.dck', save: false, page: 'imp-doom-2.html' },
  3: { name: 'Imp Doom III', file: 'cart/imp_doom_3.dck', save: true, page: 'imp-doom-3.html' },
};
const SAVE = 'DOOM1.SAV';
const TSRUN = new URL('../tsrun/', import.meta.url);
const SITE = new URL('../', import.meta.url);
const FPS = cpuHz / tStatesPerFrame, FRAME_MS = 1000 / FPS;
const $ = (id) => document.getElementById(id);

const gameNo = ['1', '2', '3'].includes(new URLSearchParams(location.search).get('game')) ? Number(new URLSearchParams(location.search).get('game')) : 3;
const game = GAMES[gameNo];
document.title = `Play ${game.name}`;
$('gname').textContent = game.name;
$('about').href = game.page;
document.querySelectorAll('[data-game]').forEach((a) => { a.classList.toggle('current', Number(a.dataset.game) === gameNo); });
$('keys3').hidden = !game.save;

const keyMatrix = new Uint8Array(8).fill(0x1F);
const joystick = new Uint8Array(2).fill(0xFF);
initJoysticks(joystick);
const padIds = ['', ''];
const m = createMachine(keyMatrix, joystick);
const screen = $('screen');
const kbd = initKeyboard(screen, keyMatrix);
const app = { m, gfx: null, sfx: null, frames: 0, paused: false, lastNow: 0, carryMs: 0, error: '' };
window.impDoom = app;                                  // for tests and the console

// ── Saved game (localStorage, key 'impdoom:DOOM1.SAV') ──
let store = null;
try { store = window.localStorage; } catch { store = null; }
const ph = createPersistentHost(store, { onChange: showSave });
app.persist = ph;
m.host = ph.host;
function showSave() {
  const line = $('saveline');
  if (!game.save) { line.textContent = 'Saved game: not used (Imp Doom ' + (gameNo === 1 ? '' : 'II ') + 'has no save key; Imp Doom III does)'; $('delsave').hidden = true; return; }
  const has = ph.has(SAVE);
  line.textContent = `Saved game: ${has ? 'yes' : 'no'}` + (ph.state.available ? '' : ` (${ph.state.error})`);
  $('delsave').hidden = !has;
}
$('delsave').onclick = () => { ph.remove(SAVE); screen.focus(); };
showSave();

async function fetchBytes(url, size) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  if (size !== undefined && b.length !== size) throw new Error(`${url}: ${b.length} bytes, expected ${size}`);
  return b;
}

function reset() {
  joystick.fill(0xFF);
  resetMachine(m);
  app.frames = 0;
}

// ── Frame loop (after LeapG web/main.js) ──
function step() {
  if (app.paused) return;
  enableSound(m, app.sfx !== null && soundIsRunning(app.sfx));
  runFrame(m);
  app.frames++;
  const chunk = takeAudio(m);
  if (chunk.n > 0 && app.sfx && soundIsRunning(app.sfx)) pushSound(app.sfx, chunk);
}
function onFrame(now) {
  requestAnimationFrame(onFrame);
  if (app.lastNow === 0) { app.lastNow = now; app.carryMs = FRAME_MS; }
  app.carryMs += Math.min(now - app.lastNow, 80);      // a backgrounded tab does not fast-forward on return
  app.lastNow = now;
  for (let ran = 0; app.carryMs >= FRAME_MS && ran < 4; ran++) { step(); app.carryMs -= FRAME_MS; }
  pollJoysticks(joystick, padIds);
  $('joy').textContent = padIds[0] ? `joystick: ${padLabel(padIds[0])}` : 'joystick: no gamepad';
  if (app.gfx) drawScreen(app.gfx, m.pixels);
  $('status').textContent = app.error || (app.paused ? 'paused' : (app.sfx && soundIsRunning(app.sfx) ? '' : 'click the screen for sound'));
}
function fillSoundQueue() {
  if (!app.sfx || !soundIsRunning(app.sfx) || app.paused) return;
  for (let ran = 0; ran < 4 && soundWantsFrame(app.sfx); ran++) {
    step();
    app.carryMs = Math.max(app.carryMs - FRAME_MS, -4 * FRAME_MS);
  }
}

// ── Input ──
screen.addEventListener('keydown', (e) => { if (app.sfx) resumeSound(app.sfx); handleKeyDown(kbd, e); });
screen.addEventListener('keyup', (e) => handleKeyUp(kbd, e));
screen.addEventListener('blur', () => handleBlur(kbd));
screen.addEventListener('pointerdown', () => { screen.focus(); if (app.sfx) resumeSound(app.sfx); });

// ── Controls ──
$('reset').onclick = () => { reset(); screen.focus(); };
$('pause').onclick = () => { app.paused = !app.paused; $('pause').textContent = app.paused ? 'Run' : 'Pause'; screen.focus(); };
$('full').onclick = () => {
  const slot = $('slot');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (slot.requestFullscreen) slot.requestFullscreen().then(() => screen.focus()).catch(() => {});
};
document.addEventListener('fullscreenchange', () => { if (app.gfx) resizeScreen(app.gfx); });

// ── Start ──
async function start() {
  const [home, exrom, vert, frag, dck] = await Promise.all([
    fetchBytes(new URL('roms/ts2068-0.rom', TSRUN), homeRomSize),
    fetchBytes(new URL('roms/ts2068-1.rom', TSRUN), exRomSize),
    fetch(new URL('screen.vert.glsl', TSRUN)).then((r) => r.text()),
    fetch(new URL('screen.frag.glsl', TSRUN)).then((r) => r.text()),
    fetchBytes(new URL(game.file, SITE)),
  ]);
  const err = setHomeRom(m, home) ?? setExRom(m, exrom);
  if (err) throw new Error(err);
  const derr = insertDock(m, dck);
  if (derr !== null) throw new Error(`Not a cartridge the TS2068 can take: ${derr}`);
  reset();

  initScreen(screen, { vert, frag }, (e, gfx) => {
    if (e !== null || gfx === null) { app.error = e ?? 'No graphics context (WebGL2 is needed)'; return; }
    app.gfx = gfx;
    resizeScreen(gfx);
  });
  new ResizeObserver(() => { if (app.gfx) resizeScreen(app.gfx); }).observe($('slot'));
  initSound(FPS, (e, sfx) => {
    if (e !== null || sfx === null) { console.warn('no sound:', e); return; }
    app.sfx = sfx;
    setSoundNeedCallback(sfx, fillSoundQueue);
    setSoundRate(m, sfx.context.sampleRate);
    setSoundStateCallback(sfx, (running) => enableSound(m, running));
    enableSound(m, soundIsRunning(sfx));
  });
  requestAnimationFrame(onFrame);
  screen.focus();
}
start().catch((e) => { app.error = String(e.message ?? e); $('status').textContent = app.error; });
