"use strict";
/*
 * fshost.js -- the host side of TSRun's file bridge (ports $6F / $6D): what answers m.host.command(n, bytes, answer) for the
 * file calls of a cartridge (open, read, write, close by name). Copied from the sibling project Leap Desktop (LeapG web/fshost.js,
 * MIT, same author) unchanged except for this comment. Imp Doom III's save / load (K / L) uses open, write, read and close; this
 * page keeps the files in the browser's localStorage (js/persist.js). The headless test (tests/save-load.mjs) uses the same code.
 *
 *   const host = createFileHost({ pick(answer) {...}, cancelPick() {...}, saved(name, bytes, binary) {...} });
 *   m.host = host;           host.files: Map name -> Uint8Array (the host's bytes, before text conversion)
 *
 * pick(answer): the user is asked for a file; later answer(name, bytes) adds it to host.files and answers 1 with its name
 * (made usable: 2), or answer(null) answers 12 (cancelled). cancelPick(): an abort while picking (close the picker).
 * saved(name, bytes, binary): a file written and closed (bytes as the host stores them: text has LF line ends).
 */

export const ST_OK = 1, ST_NAME = 3, ST_ROOM = 6, ST_EOF = 7, ST_CANCEL = 12;
export const MAX_FILE = 65535;
export const MAX_NAME = 30;
const BAD = '/\\:*?"<>|';

/** A name (a string) the FS_ calls accept: 1-30 codes from 32-126, none of / \ : * ? " < > | (FILES 2). */
export function nameOk(name) {
  if (name.length < 1 || name.length > MAX_NAME) return false;
  for (const c of name) {
    const k = c.charCodeAt(0);
    if (k < 32 || k > 126 || BAD.includes(c)) return false;
  }
  return true;
}

/** A host file's name made usable: other codes become '_', and a name longer than 30 keeps its extension (up to 8). */
export function usableName(name) {
  let s = '';
  for (const c of name) {
    const k = c.codePointAt(0);
    s += (k < 32 || k > 126 || BAD.includes(c)) ? '_' : c;
  }
  if (s.length === 0) s = '_';
  if (s.length > MAX_NAME) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : '';
    s = s.slice(0, MAX_NAME - ext.length) + ext;
  }
  return s;
}

/** Text mode, reading (FILES 2): CR LF, LF and CR each become 13; TAB a space; other codes below 32 dropped; above 126 '?'. */
export function textIn(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 13) { out.push(13); if (bytes[i + 1] === 10) i++; }
    else if (b === 10) out.push(13);
    else if (b === 9) out.push(32);
    else if (b < 32) continue;
    else if (b > 126) out.push(63);
    else out.push(b);
  }
  return Uint8Array.from(out);
}

/** Text mode, writing: each 13 becomes LF; other bytes as they are. */
export function textOut(bytes) {
  return Uint8Array.from(bytes, (b) => (b === 13 ? 10 : b));
}

const str = (bytes) => String.fromCharCode(...bytes);

/**
 * @param {{ pick?: (answer: (name: string|null, bytes?: Uint8Array) => void) => void,
 *           cancelPick?: () => void,
 *           saved?: (name: string, bytes: Uint8Array, binary: boolean) => void }} hooks
 */
export function createFileHost(hooks = {}) {
  const host = {
    files: new Map(),
    open: null,          // { name, write, binary, data: Uint8Array | number[], pos }
    picking: false,
    log: [],             // every command: { n, bytes } (for tests)
    command(n, bytes, answer) {
      host.log.push({ n, bytes: Uint8Array.from(bytes) });
      switch (n) {
        case 0: return abort();
        case 1: return pick(answer);
        case 2: return open(bytes);
        case 3: return read(bytes);
        case 4: return write(bytes);
        case 5: return close();
        default: return { status: ST_NAME };
      }
    },
  };

  let pickId = 0;

  function abort() {
    if (host.picking) { host.picking = false; hooks.cancelPick?.(); }
    host.open = null;
    return { status: ST_CANCEL };
  }

  function pick(answer) {
    if (!hooks.pick) return { status: ST_CANCEL };
    host.picking = true;
    const id = ++pickId;                       // an answer to an earlier, abandoned pick must not complete this one
    hooks.pick((name, data) => {
      if (id !== pickId || !host.picking) return;
      host.picking = false;
      if (name === null || name === undefined) { answer(ST_CANCEL); return; }
      const nm = usableName(name);
      host.files.set(nm, Uint8Array.from(data ?? []));
      answer(ST_OK, [nm.length, ...Array.from(nm, (c) => c.charCodeAt(0))]);
    });
    return null;
  }

  function open(bytes) {
    host.open = null;
    const mode = bytes[0], len = bytes[1];
    const name = str(bytes.subarray(2, 2 + len));
    if (len !== bytes.length - 2 || !nameOk(name)) return { status: ST_NAME };
    const write = (mode & 1) !== 0, binary = (mode & 2) !== 0;
    if (write) {
      host.open = { name, write, binary, data: [], pos: 0 };
      return { status: ST_OK, data: [0, 0] };
    }
    const raw = host.files.get(name);
    if (raw === undefined) return { status: ST_NAME };
    const data = binary ? raw : textIn(raw);
    if (data.length > MAX_FILE) return { status: ST_NAME };
    host.open = { name, write, binary, data, pos: 0 };
    return { status: ST_OK, data: [data.length & 0xFF, data.length >> 8] };
  }

  function read(bytes) {
    const f = host.open;
    if (f === null || f.write) return { status: ST_NAME };
    if (f.pos >= f.data.length) return { status: ST_EOF };
    const want = bytes[0] | (bytes[1] << 8);
    const n = Math.min(want, f.data.length - f.pos);
    const out = [n & 0xFF, n >> 8, ...f.data.subarray(f.pos, f.pos + n)];
    f.pos += n;
    return { status: ST_OK, data: out };
  }

  function write(bytes) {
    const f = host.open;
    if (f === null || !f.write) return { status: ST_NAME };
    const n = bytes.length - 2;
    if (f.data.length + n > MAX_FILE) return { status: ST_ROOM };
    for (let i = 2; i < bytes.length; i++) f.data.push(bytes[i]);
    return { status: ST_OK };
  }

  function close() {
    const f = host.open;
    host.open = null;
    if (f !== null && f.write) {
      const data = f.binary ? Uint8Array.from(f.data) : textOut(f.data);
      host.files.set(f.name, data);
      hooks.saved?.(f.name, data, f.binary);
    }
    return { status: ST_OK };
  }

  return host;
}
