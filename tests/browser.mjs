// Browser end-to-end check through headless Chrome over the DevTools protocol (no extra packages; needs Node 22+ for WebSocket).
// Part A: play.html?game=N still works: loads each game, waits, takes screenshots, and (game 3) presses SPACE (start), K (save), L (load), then reloads
// the page and checks that localStorage still holds 'impdoom:DOOM1.SAV' and the page says "Saved game: yes".
// Part B: index.html, the main page with the embedded player: the poster, the three tabs (each machine runs: frames advance, the title border is
// that game's), quick switching, Pause / Run / Reset, SPACE then K on Imp Doom III gives localStorage 'impdoom:DOOM1.SAV', Delete save,
// deep links (#play=N, ?game=N), console errors (only the known headless audio-worklet one is allowed), and screenshots at 1200 and 390 wide
// plus a dark-mode one.
//   python3 -m http.server 8123 &      node tests/browser.mjs [outdir] [base] [chrome-path]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/impdoom-shots', base = process.argv[3] ?? 'http://127.0.0.1:8123';
const chrome = process.argv[4] ?? process.env.CHROME;
mkdirSync(out, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1100,900', '--user-data-dir=' + out + '/profile', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const consoleMsgs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') consoleMsgs.push({ type: 'exception', text: ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text) + ' @ ' + (m.params.exceptionDetails.url || '') });
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) consoleMsgs.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400) });
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('shot', name); };
const key = async (code, k, hold = 250) => { const p = { key: k, code, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }; await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p }); await sleep(hold); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p }); };
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
await send('Runtime.enable'); await send('Page.enable');
async function open(game) { await send('Page.navigate', { url: `${base}/play.html?game=${game}` }); await sleep(2500); await ev("document.getElementById('screen').focus()"); }
for (const game of [1, 2, 3]) {
  await open(game); await sleep(4000);
  await shot(`play${game}_title`);
  ok((await ev('window.impDoom && window.impDoom.frames')) > 100, `game ${game}: the emulator is running (frames ${await ev('window.impDoom.frames')})`);
  ok(!(await ev('window.impDoom.error')), `game ${game}: no error (${await ev('window.impDoom.error')})`);
}
// game 3 end to end
await open(3); await sleep(4500);
await ev("localStorage.removeItem('impdoom:DOOM1.SAV')");
await key('Space', ' '); await sleep(3500);
await key('KeyQ', 'q', 800); await sleep(300);
await shot('play3_level');
await key('KeyK', 'k'); await sleep(900);
const sv = await ev("localStorage.getItem('impdoom:DOOM1.SAV')");
ok(!!sv && atob(sv).length === 277, `K: localStorage impdoom:DOOM1.SAV has ${sv ? atob(sv).length : 0} bytes`);
ok((await ev("document.getElementById('saveline').textContent")).includes('yes'), `saved line: ${await ev("document.getElementById('saveline').textContent")}`);
await key('KeyQ', 'q', 1200); await key('KeyL', 'l'); await sleep(800);
await shot('play3_after_load');
await open(3); await sleep(4500);
ok((await ev("document.getElementById('saveline').textContent")).includes('yes'), 'after a reload the page still says saved game: yes');
await key('KeyL', 'l'); await sleep(2500);
await shot('play3_reload_load');
await ev("document.getElementById('delsave').click()");
ok(!(await ev("localStorage.getItem('impdoom:DOOM1.SAV')")) && (await ev("document.getElementById('saveline').textContent")).includes('no'), 'Delete save removes it');

// ───────────── Part B: index.html, the main page with the embedded player ─────────────
const rect = async (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
const click = async (sel) => { const r = await rect(sel); if (!r) throw new Error('no element ' + sel); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }); };
const frames = () => ev('window.impDoom ? window.impDoom.frames : -1');
const gameNo = () => ev('window.impDoom ? window.impDoom.game : -1');
async function advances(label, ms = 1500) { const a = await frames(); await sleep(ms); const b = await frames(); ok(b - a > 10, `${label}: frames advance (${a} -> ${b})`); }
const TITLE_BORDER = { 1: 0, 2: 1, 3: 4 };      // the title screens: black, blue, green

await send('Page.navigate', { url: `${base}/index.html` }); await sleep(2500);
ok((await ev('document.title')) === 'Imp Doom', `index.html title is "${await ev('document.title')}"`);
ok((await ev("document.querySelector('[data-role=poster]').hidden")) === false, 'before Play the poster ("Press to play") covers the screen');
ok((await frames()) === 0, 'nothing runs before Play (frames 0)');
await shot('index_poster');
// hero Play button: selects III in the embedded player, starts it
await click('.hero .cta a[data-playlink]'); await sleep(4500);
ok((await gameNo()) === 3, `the hero Play button starts game ${await gameNo()} (expected 3)`);
ok((await ev("document.querySelector('[data-role=poster]').hidden")) === true, 'the poster is gone once it runs');
await advances('index, game 3 via the hero Play button');
// tabs: 1, 2, 3, then 1 again
for (const g of [1, 2, 3, 1]) {
  await click(`.tabs button[data-game="${g}"]`); await sleep(700);
  ok((await frames()) < 120, `tab ${g}: the machine restarted (${await frames()} refreshes 0.7 s after the click; one refresh = 1/60 s)`);
  await sleep(3500);
  ok((await gameNo()) === g, `tab ${g}: the player runs game ${await gameNo()}`);
  ok((await ev("document.querySelector('.tabs button.current').dataset.game")) === String(g), `tab ${g}: the tab is marked current`);
  ok((await ev('window.impDoom.m.border')) === TITLE_BORDER[g], `tab ${g}: the title border is ${TITLE_BORDER[g]} (got ${await ev('window.impDoom.m.border')})`);
  await advances(`tab ${g}`);
  ok(!(await ev('window.impDoom.error')), `tab ${g}: no error (${await ev('window.impDoom.error')})`);
  await shot(`index_tab${g}`);
}
// quick switching: three clicks with no wait; the last one wins and the machine runs
for (const g of [2, 3, 1, 2]) { await click(`.tabs button[data-game="${g}"]`); await sleep(60); }
await sleep(4200);
ok((await gameNo()) === 2 && !(await ev('window.impDoom.switching')), `quick switching: ends on game 2 (${await gameNo()}), not stuck loading`);
await advances('after quick switching');
// pause, run, reset
await click('[data-role=pause]'); await sleep(300);
const pf = await frames(); await sleep(800);
ok((await frames()) === pf && (await ev("document.querySelector('[data-role=pause]').textContent")) === 'Run', `Pause: frames stop at ${pf}`);
await click('[data-role=pause]'); await advances('after Run');
await click('.tabs button[data-game="3"]'); await sleep(4200);
await click('[data-role=reset]'); await sleep(300);
ok((await frames()) < 40, `Reset restarts the machine (frames ${await frames()})`);
// SPACE then K on III through the embedded player, with the real keyboard
await ev("localStorage.removeItem('impdoom:DOOM1.SAV')"); await sleep(300);
await click('.tabs button[data-game="3"]'); await sleep(4200);
await ev("document.querySelector('[data-role=screen]').focus()");
await key('Space', ' '); await sleep(3500);
await key('KeyQ', 'q', 800); await sleep(300);
await key('KeyK', 'k'); await sleep(900);
const sv2 = await ev("localStorage.getItem('impdoom:DOOM1.SAV')");
ok(!!sv2 && atob(sv2).length === 277, `index.html: SPACE then K: localStorage impdoom:DOOM1.SAV has ${sv2 ? atob(sv2).length : 0} bytes`);
ok((await ev("document.querySelector('[data-role=saveline]').textContent")).includes('yes'), `index.html saved line: ${await ev("document.querySelector('[data-role=saveline]').textContent")}`);
ok((await ev("document.querySelector('[data-role=delsave]').hidden")) === false, 'Delete save button is shown');
// the save line is Imp Doom III's only
await click('.tabs button[data-game="1"]'); await sleep(2500);
ok((await ev("document.querySelector('[data-role=saveline]').textContent")).includes('not used'), `game 1: ${await ev("document.querySelector('[data-role=saveline]').textContent")}`);
ok(await ev("localStorage.getItem('impdoom:DOOM1.SAV')") === sv2, 'switching to game 1 leaves the save alone');
await click('.tabs button[data-game="3"]'); await sleep(2500);
await click('[data-role=delsave]'); await sleep(200);
ok(!(await ev("localStorage.getItem('impdoom:DOOM1.SAV')")) && (await ev("document.querySelector('[data-role=saveline]').textContent")).includes('no'), `index.html: Delete save removes it (storage ${await ev("localStorage.getItem('impdoom:DOOM1.SAV')")}, line "${await ev("document.querySelector('[data-role=saveline]').textContent")}")`);
// deep links
for (const [url, g] of [['index.html#play=2', 2], ['index.html#play=1', 1], ['index.html?game=3', 3]]) {
  await send('Page.navigate', { url: `${base}/${url}` }); await sleep(1000);
  await ev('location.reload()'); await sleep(5000);
  ok((await gameNo()) === g, `deep link ${url}: game ${await gameNo()} (expected ${g})`);
  await advances(`deep link ${url}`, 1200);
}
// the hash link inside the page, on a page that is already open
await send('Page.navigate', { url: `${base}/index.html` }); await sleep(2500);
await ev("document.querySelector('a[data-playlink][href=\"#play=1\"]').click()"); await sleep(4500);
ok((await gameNo()) === 1, `a Play link on the page (card for game 1) selects game ${await gameNo()}`);
// screenshots: desktop 1200, phone 390, dark
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${base}/index.html#play=3` }); await sleep(6000);
await ev('window.scrollTo(0,0)'); await sleep(500);
// section by section (a viewport each; Chrome's beyond-the-viewport capture of a very tall page repeats its top): scroll slowly first so lazy images load
const SECTIONS = ['getting-started', 'how-differ', 'compare', 'pictures', 'docs', 'credits', 'family'];
const full = async (name) => {
  const h = await ev('document.documentElement.scrollHeight');
  for (let y = 0; y < h; y += 600) { await ev(`window.scrollTo({ top: ${y}, behavior: 'instant' })`); await sleep(40); }
  for (const id of SECTIONS) {
    await ev(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'start', behavior: 'instant' })`); await sleep(350);
    await shot(`${name}_${id}`);
  }
  await ev("window.scrollTo({ top: 0, behavior: 'instant' })"); await sleep(300);
};
await shot('index_desktop_top'); await full('index_desktop');
ok((await ev('document.documentElement.scrollWidth')) <= 1200, `1200 wide: no horizontal scroll (scrollWidth ${await ev('document.documentElement.scrollWidth')})`);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `${base}/index.html` }); await sleep(3000);
await shot('index_phone_top'); await full('index_phone');
ok((await ev('document.documentElement.scrollWidth')) <= 390, `390 wide: no horizontal scroll (scrollWidth ${await ev('document.documentElement.scrollWidth')})`);
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.navigate', { url: `${base}/index.html#play=3` }); await sleep(6000);
await ev('window.scrollTo(0,0)'); await sleep(300);
await shot('index_dark_top'); await ev("document.getElementById('compare').scrollIntoView()"); await sleep(300); await shot('index_dark_compare');
ok((await ev('getComputedStyle(document.body).backgroundColor')) === 'rgb(16, 17, 22)', `dark mode: body background ${await ev('getComputedStyle(document.body).backgroundColor')}`);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
// the known headless-only error: the AudioWorkletNode of tsrun/sound.js cannot be built without a real audio device
const bad = consoleMsgs.filter((m) => !/AudioWorkletNode|audio ?worklet|no sound/i.test(m.text));
ok(bad.length === 0, `console: ${consoleMsgs.length} message(s), ${bad.length} other than the known headless audio-worklet one`);
if (consoleMsgs.length) console.log('console:', consoleMsgs.slice(0, 6));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
proc.kill(); process.exit(fails ? 1 : 0);
