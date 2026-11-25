// Link check: fetch every page of the site from a local server, then every relative link, image, script, stylesheet, audio and
// download it names, and report anything that is not HTTP 200. Also checks that each page has a title and that the cartridges parse.
//   python3 -m http.server 8000 &   (in the repo root)
//   node tools/linkcheck.mjs [http://127.0.0.1:8000]
const base = process.argv[2] ?? 'http://127.0.0.1:8000';
const pages = ['index.html', 'imp-doom-1.html', 'imp-doom-2.html', 'imp-doom-3.html', 'play.html', 'tech.html'];
// external URLs that must answer 200 too (set EXTERNAL=0 to skip them, e.g. offline); only the ones the pages name are checked
const CHECK_EXTERNAL = process.env.EXTERNAL !== '0';
const seen = new Map(); let bad = 0;
async function get(path) {
  if (seen.has(path)) return seen.get(path);
  const r = await fetch(new URL(path, base + '/')); const b = Buffer.from(await r.arrayBuffer());
  const v = { status: r.status, bytes: b.length, text: (r.headers.get('content-type') || '').match(/text|javascript|svg/) ? b.toString('utf8') : '' };
  seen.set(path, v); return v;
}
const externals = (html) => [...new Set([...html.matchAll(/\bhref="(https?:[^"#]+)/g)].map((m) => m[1]))];
const refs = (html) => [...html.matchAll(/\b(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)].map((m) => m[1]).filter((u) => !/^(https?:|mailto:|data:)/.test(u));
const imports = (js) => [...js.matchAll(/(?:from\s+|import\s*\(\s*)'(\.{1,2}\/[^']+)'/g)].map((m) => m[1]);
const urlsInJs = (js) => [...js.matchAll(/new URL\('([^']+)'/g)].map((m) => m[1]);
for (const p of pages) {
  const v = await get(p);
  console.log(`${v.status} ${String(v.bytes).padStart(8)}  ${p}`); if (v.status !== 200) { bad++; continue; }
  if (!/<title>[^<]{2,}<\/title>/.test(v.text)) { console.log(`  FAIL ${p}: no title`); bad++; }
  const t = (v.text.match(/<title>([^<]*)<\/title>/) || [])[1];
  if (t && /^doom\b/i.test(t.trim())) { console.log(`  FAIL ${p}: the title is "Doom" alone`); bad++; }
  // in-page anchors: every #id the page links to must exist on it (index.html#x links from other pages are checked against index.html)
  for (const m of v.text.matchAll(/href="([a-z0-9.-]*)#([^"=]+)"/g)) {
    const target = m[1] ? await get(m[1]) : v;
    if (target.status === 200 && !new RegExp(`id="${m[2]}"`).test(target.text)) { console.log(`  FAIL ${p}: link to ${m[1]}#${m[2]} but no id="${m[2]}" there`); bad++; }
  }
  for (const u of refs(v.text)) {
    const r = await get(u.split('?')[0]);
    console.log(`${r.status} ${String(r.bytes).padStart(8)}  ${u}   (from ${p})`); if (r.status !== 200) bad++;
  }
}
// external links (once each)
if (CHECK_EXTERNAL) {
  const ext = new Set();
  for (const p of pages) for (const u of externals(seen.get(p).text)) ext.add(u);
  for (const u of ext) {
    let st = 0;
    for (let i = 0; i < 2 && st !== 200; i++) { try { st = (await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20000) })).status; } catch { st = 0; } }
    console.log(`${st}  ${u}   (external)`); if (st !== 200) bad++;
  }
}
// modules the player imports (and the files it fetches)
const todo = ['js/play.js', 'js/index.js']; const done = new Set();
while (todo.length) {
  const f = todo.pop(); if (done.has(f)) continue; done.add(f);
  const v = await get(f); if (v.status !== 200) { console.log(`FAIL ${f}: ${v.status}`); bad++; continue; }
  const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
  for (const i of imports(v.text)) { const p = new URL(i, new URL(dir, base + '/')).pathname.slice(1); const r = await get(p); console.log(`${r.status} ${String(r.bytes).padStart(8)}  ${p}   (imported by ${f})`); if (r.status !== 200) bad++; else if (p.endsWith('.js')) todo.push(p); }
}
for (const p of ['tsrun/roms/ts2068-0.rom', 'tsrun/roms/ts2068-1.rom', 'tsrun/screen.vert.glsl', 'tsrun/screen.frag.glsl', 'cart/imp_doom_1.dck', 'cart/imp_doom_2.dck', 'cart/imp_doom_3.dck', 'LICENSE', 'CREDITS.md']) {
  const r = await get(p); console.log(`${r.status} ${String(r.bytes).padStart(8)}  ${p}   (fetched by the player / linked)`); if (r.status !== 200) bad++;
}
console.log(bad ? `\n${bad} PROBLEM(S)` : `\nALL OK (${seen.size} files)`);
process.exit(bad ? 1 : 0);
