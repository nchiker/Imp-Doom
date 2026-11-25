// Browser end-to-end check through headless Chrome over the DevTools protocol (no extra packages; needs Node 22+ for WebSocket).
// Loads play.html?game=N, waits, takes screenshots, and (game 3) presses SPACE (start), K (save), L (load), then reloads the page and checks
// that localStorage still holds 'impdoom:DOOM1.SAV' and the page says "Saved game: yes".
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
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') consoleMsgs.push(JSON.stringify(m.params).slice(0, 300)); };
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
if (consoleMsgs.length) console.log('console:', consoleMsgs.slice(0, 5));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
proc.kill(); process.exit(fails ? 1 : 0);
