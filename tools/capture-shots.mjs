// Captures the "Getting started" pictures of index.html from the running page with headless Chrome (CDP, no extra packages; Node 22+).
//   python3 -m http.server 8123 &      node tools/capture-shots.mjs [base] [chrome-path]
// Writes img/shots/step1_open.png (player before Play), step2_focus.png (running, keyboard focus), step4_play.png (level 1) and
// step6_saved.png (a moment after K: white border, "Saved game: yes"). Each is a clip of the player block (#play) at 1200 px wide.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const base = process.argv[2] ?? 'http://127.0.0.1:8123', chrome = process.argv[3] ?? process.env.CHROME;
const here = new URL('../img/shots/', import.meta.url).pathname; mkdirSync(here, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500), prof = mkdtempSync(tmpdir() + '/impshots-');
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1200,1000', '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const key = async (code, k, hold = 250) => { const p = { key: k, code, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }; await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p }); await sleep(hold); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p }); };
const clip = async (name) => {
  const r = await ev(`(() => { const e = document.getElementById('play'); e.scrollIntoView({ block: 'start', behavior: 'instant' }); const b = e.getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, w: b.width, h: b.height }; })()`);
  await sleep(300);
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } });
  writeFileSync(here + name + '.png', Buffer.from(s.result.data, 'base64')); console.log('wrote', name, Math.round(r.w) + 'x' + Math.round(r.h));
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${base}/index.html` }); await sleep(2500);
await ev("localStorage.removeItem('impdoom:DOOM1.SAV')");
await clip('step1_open');
await ev("window.impDoomPlayer && 0; document.querySelector('[data-role=poster]').click()"); await sleep(4500);
await ev("document.querySelector('[data-role=screen]').focus()"); await sleep(300);
await clip('step2_focus');
await key('Space', ' '); await sleep(3500);
await clip('step4_play');
await key('KeyK', 'k', 120);
// the save cue is a white border for about half a second: wait until the machine shows it, then capture at once
for (let i = 0; i < 100 && (await ev('window.impDoom.m.border')) !== 7; i++) await sleep(15);
await ev('window.impDoom.hidden = true'); await sleep(150);      // hold the machine on that frame (as if scrolled away) so the cue is still on the picture
console.log('border at capture:', await ev('window.impDoom.m.border'));
await clip('step6_saved');
await ev('window.impDoom.hidden = false');
await ev("localStorage.removeItem('impdoom:DOOM1.SAV')");
proc.kill(); process.exit(0);
