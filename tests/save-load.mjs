// Headless test of K (save) and L (load) in Imp Doom III: TSRun's machine in Node, the real TS2068 ROMs, cart/imp_doom_3.dck, and the
// page's own persistent file host (js/persist.js) on a fake localStorage. Keys go through the keyboard matrix (K = row 6 bit 2, L = row 6 bit 1,
// active low), as the keyboard does. Modelled on the Doom project's spike-h/c3/save-cart.mjs.
//   node tests/save-load.mjs [cart.dck]
import { readFileSync } from 'node:fs';
import { createMachine, setHomeRom, setExRom, resetMachine, runFrame, insertDock } from '../tsrun/machine.js';
import { createPersistentHost, PREFIX, b64decode } from '../js/persist.js';

const root = new URL('../', import.meta.url);
const rd = (p) => new Uint8Array(readFileSync(new URL(p, root)));
const cartPath = process.argv[2] ?? 'cart/imp_doom_3.dck';
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };

class FakeStorage {                       // localStorage lookalike
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const storage = new FakeStorage();
const ph = createPersistentHost(storage);
ok(ph.state.available, 'persistent host: storage available');

const keyMatrix = new Uint8Array(8).fill(0x1F), joystick = new Uint8Array(2).fill(0xFF);
const m = createMachine(keyMatrix, joystick);
const e0 = setHomeRom(m, rd('tsrun/roms/ts2068-0.rom')) ?? setExRom(m, rd('tsrun/roms/ts2068-1.rom'));
ok(e0 === null || e0 === undefined, 'stock TS2068 ROMs accepted');
const e1 = insertDock(m, rd(cartPath));
ok(e1 === null, `cartridge ${cartPath} accepted`);
const cmds = []; const realCmd = ph.host.command;
m.host = { command(n, bytes, answer) { cmds.push({ n, bytes: Uint8Array.from(bytes) }); const r = realCmd(n, bytes, answer); return r; } };
resetMachine(m);

// key = [row, bit] on the TS2068 matrix: O P Q A Z X SPACE E K L and the rest as in tsrun/keyboard.js
const KEY = { SPACE: [7, 0], K: [6, 2], L: [6, 1], Q: [2, 0], O: [5, 1], P: [5, 0] };
const down = (k) => { keyMatrix[KEY[k][0]] &= ~(1 << KEY[k][1]); };
const up = (k) => { keyMatrix[KEY[k][0]] |= (1 << KEY[k][1]); };
const frames = (n) => { for (let i = 0; i < n; i++) runFrame(m); };
const pose = () => { const r = m.ram; return [r[0xF000] | r[0xF001] << 8, r[0xF002] | r[0xF003] << 8, r[0xF004]].join(','); };
const borders = []; const watch = (n) => { for (let i = 0; i < n; i++) { runFrame(m); borders.push(m.border); } };

// boot: the ROM hands over after about 2 s, then the title (green border)
frames(260);
ok(m.border === 4, `title screen border is green (got ${m.border})`);
// L on the title with no file: failure cue (magenta 3), file untouched
borders.length = 0; down('L'); watch(8); up('L'); watch(12);
ok(borders.includes(3), `L with no saved game: magenta failure cue (borders ${[...new Set(borders)]})`);
ok(cmds.some(c => c.n === 2) && !ph.has('DOOM1.SAV'), 'L with no saved game: a file open was asked, no file exists (status 3)');
frames(30);
// start a game: SPACE on the title; generating a level takes several refreshes
down('SPACE'); frames(6); up('SPACE'); frames(120);
const p0 = pose();
// walk: forward + turn so the pose is different from the start
down('Q'); frames(20); up('Q'); down('O'); frames(10); up('O'); frames(5);
const pSaved = pose();
ok(pSaved !== p0, `the player moved (${p0} -> ${pSaved})`);
// K
cmds.length = 0; borders.length = 0; down('K'); watch(8); up('K'); watch(14);
const f = ph.host.files.get('DOOM1.SAV');
ok(!!f, 'K: DOOM1.SAV exists in the host');
console.log(`     DOOM1.SAV is ${f ? f.length : 0} bytes (the task brief said 261; docs/SPIKE_AC5_RESULTS.md says 277)`);
ok(f && f.length === 277, 'K: DOOM1.SAV has the length the AC-5 results document (277 bytes)');
const mode = cmds.find(c => c.n === 2)?.bytes[0];
console.log(`     open mode byte ${mode} (bit 1 set = binary)`);
ok(mode !== undefined && (mode & 2) !== 0, 'K: the game opens the file in binary mode (no text conversion)');
ok(borders.includes(7), `K: white "saved" cue (borders ${[...new Set(borders)]})`);
ok(cmds.filter(c => c.n === 5).length === 1, 'K: exactly one file close');
const stored = storage.getItem(PREFIX + 'DOOM1.SAV');
ok(!!stored && Buffer.from(b64decode(stored)).equals(Buffer.from(f ?? [])), "K: localStorage 'impdoom:DOOM1.SAV' holds the same bytes (base64)");
// play on: walk elsewhere
down('P'); frames(40); up('P'); down('Q'); frames(25); up('Q'); frames(5);
const pMoved = pose();
ok(pMoved !== pSaved, `20+ frames later the pose differs (${pSaved} -> ${pMoved})`);
// L
cmds.length = 0; borders.length = 0; down('L'); watch(8); up('L'); watch(20);
const pLoaded = pose();
ok(borders.includes(6), `L: yellow "loaded" cue (borders ${[...new Set(borders)]})`);
ok(pLoaded === pSaved, `L: the saved pose is back (want ${pSaved}, got ${pLoaded})`);
ok(cmds.some(c => c.n === 3), 'L: the game read the file');
// a reload: a NEW host on the same storage still has the file (persistence)
const ph2 = createPersistentHost(storage);
ok(ph2.has('DOOM1.SAV') && ph2.size('DOOM1.SAV') === f.length, 'a new host on the same storage preloads DOOM1.SAV');
// a second machine (a new page load) with that host: L on its own title loads the saved game (the level is regenerated first)
{
  const km2 = new Uint8Array(8).fill(0x1F), m2 = createMachine(km2, new Uint8Array(2).fill(0xFF));
  setHomeRom(m2, rd('tsrun/roms/ts2068-0.rom')); setExRom(m2, rd('tsrun/roms/ts2068-1.rom')); insertDock(m2, rd(cartPath)); m2.host = ph2.host; resetMachine(m2);
  for (let i = 0; i < 260; i++) runFrame(m2);
  km2[6] &= ~2; for (let i = 0; i < 8; i++) runFrame(m2); km2[6] |= 2;            // L (bit 1)
  for (let i = 0; i < 150; i++) runFrame(m2);
  const r = m2.ram, p2 = [r[0xF000] | r[0xF001] << 8, r[0xF002] | r[0xF003] << 8, r[0xF004]].join(',');
  ok(p2 === pSaved, `second machine, L on the title: the saved game is loaded (want ${pSaved}, got ${p2})`);
}
ph2.remove('DOOM1.SAV');
ok(!ph2.has('DOOM1.SAV') && storage.getItem(PREFIX + 'DOOM1.SAV') === null, 'Delete save: gone from host and storage');
// storage that throws
const bad = { get length() { throw new Error('x'); }, key() { throw new Error('x'); }, getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
const ph3 = createPersistentHost(bad);
ok(!ph3.state.available && ph3.state.error.length > 0, 'unavailable storage: memory-only mode with a message, no throw');
ok(createPersistentHost(null).state.available === false, 'no localStorage object: memory-only mode');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
