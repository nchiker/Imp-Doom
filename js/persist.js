"use strict";
/*
 * persist.js -- a file host (js/fshost.js) whose files live in the browser's localStorage, so Imp Doom III's save
 * (K) survives a reload. One localStorage key per file: 'impdoom:' + file name (for example 'impdoom:DOOM1.SAV'), the bytes as
 * base64. All files with that prefix are loaded when the host is made; a file the game closes after writing is stored at once
 * (the `saved` callback of createFileHost). No file picker, no download prompt.
 *
 * Only Imp Doom III binds a key to save / load; Imp Doom I and II never open a file, so they never write one. The three games
 * share the one name DOOM1.SAV (the cartridge's own name for its slot).
 *
 * localStorage can be missing or can refuse (private window, blocked site data, quota): then `available` is false and the files
 * live in memory for this page only; nothing throws. A file that is not there answers status 3 (ST_NAME, "no file") through
 * createFileHost, which the game shows as its failure cue.
 */
import { createFileHost } from './fshost.js';

export const PREFIX = 'impdoom:';

export function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(text) {
  const s = atob(text), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * @param {Storage|null} storage  window.localStorage (or null / a thing that throws: memory only)
 * @param {{ onChange?: () => void }} [opts]
 */
export function createPersistentHost(storage, opts = {}) {
  const state = { available: false, error: '' };
  const probe = () => {
    if (!storage) return false;
    try { const k = PREFIX + '.probe'; storage.setItem(k, '1'); storage.removeItem(k); return true; } catch { return false; }
  };
  state.available = probe();
  if (!state.available) state.error = 'saved games cannot be kept in this browser (local storage is unavailable): a save lasts until the page is closed';

  const host = createFileHost({
    saved(name, bytes) {
      if (state.available) {
        try { storage.setItem(PREFIX + name, b64encode(bytes)); }
        catch { state.available = false; state.error = 'the browser refused to store the save (storage full or blocked): it lasts until the page is closed'; }
      }
      opts.onChange?.();
    },
  });

  if (state.available) {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(PREFIX) && k !== PREFIX + '.probe') keys.push(k); }
      for (const k of keys) {
        try { host.files.set(k.slice(PREFIX.length), b64decode(storage.getItem(k))); } catch { /* a damaged entry is ignored (the game then sees no file) */ }
      }
    } catch { state.available = false; }
  }

  return {
    host, state,
    has: (name) => host.files.has(name),
    size: (name) => (host.files.get(name) ?? { length: 0 }).length,
    remove(name) {
      host.files.delete(name);
      if (state.available) { try { storage.removeItem(PREFIX + name); } catch { /* ignore */ } }
      opts.onChange?.();
    },
  };
}
