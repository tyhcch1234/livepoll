/* LivePoll core — pure logic, no DOM. Shared by browser pages and unit tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PollCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const TOPIC_PREFIX = 'livedot/v1';
  const MAX_ITEMS = 3000;

  function randomInts(n) {
    const buf = new Uint32Array(n);
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    if (c) {
      c.getRandomValues(buf);
    } else {
      for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 4294967296);
    }
    return buf;
  }

  function makeCode(len) {
    const n = len || 6;
    const rnd = randomInts(n);
    let out = '';
    for (let i = 0; i < n; i++) out += ALPHABET[rnd[i] % ALPHABET.length];
    return out;
  }

  function normalizeCode(raw) {
    return String(raw || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10);
  }

  function makeId() {
    const rnd = randomInts(3);
    return (
      'r' +
      Date.now().toString(36) +
      rnd[0].toString(36) +
      rnd[1].toString(36) +
      rnd[2].toString(36)
    ).slice(0, 22);
  }

  function topics(code) {
    const c = normalizeCode(code);
    return {
      resp: TOPIC_PREFIX + '/' + c + '/resp',
      state: TOPIC_PREFIX + '/' + c + '/state',
    };
  }

  function emptyState(code) {
    return { v: 1, code: normalizeCode(code), poll: null, items: [], updatedAt: 0 };
  }

  function sanitizeText(value, max) {
    const limit = max || 140;
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  function normalizePoll(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = ['choice', 'word', 'open', 'rating'].includes(raw.type) ? raw.type : 'open';
    const q = sanitizeText(raw.q, 180) || '未命名問題';
    let options = Array.isArray(raw.options)
      ? raw.options.map(function (o) { return sanitizeText(o, 60); }).filter(Boolean).slice(0, 8)
      : [];
    if (type === 'choice' && options.length < 2) options = ['選項 A', '選項 B'];
    if (type !== 'choice') options = [];
    return {
      q: q,
      type: type,
      options: options,
      nameRequired: !!raw.nameRequired,
      showResults: raw.showResults !== false,
      maxLen: type === 'word' ? 24 : type === 'open' ? 140 : 0,
    };
  }

  function validRecord(state, rec) {
    if (!rec || typeof rec !== 'object' || !rec.id) return null;
    const poll = state.poll || {};
    const out = {
      id: String(rec.id).slice(0, 32),
      name: sanitizeText(rec.name, 24),
      ts: Number(rec.ts) || Date.now(),
    };
    if (poll.type === 'choice') {
      const idx = Number(rec.opt);
      if (!Number.isInteger(idx) || idx < 0 || idx >= (poll.options || []).length) return null;
      out.opt = idx;
      out.text = null;
    } else if (poll.type === 'rating') {
      const v = Number(rec.opt);
      if (!Number.isInteger(v) || v < 1 || v > 5) return null;
      out.opt = v;
      out.text = null;
    } else {
      const txt = sanitizeText(rec.text, poll.maxLen || 140);
      if (!txt) return null;
      out.opt = null;
      out.text = txt;
    }
    return out;
  }

  /** Add or replace one response. Same id => updated answer (one device, one answer). */
  function applyResponse(state, rec) {
    const base = state || emptyState('');
    if (!base.poll) return base;
    const clean = validRecord(base, rec);
    if (!clean) return base;
    const items = (base.items || []).slice();
    const at = items.findIndex(function (it) { return it.id === clean.id; });
    if (at >= 0) items[at] = clean;
    else items.push(clean);
    if (items.length > MAX_ITEMS) items.splice(0, items.length - MAX_ITEMS);
    return Object.assign({}, base, { items: items, updatedAt: Date.now() });
  }

  /** Union two states (used when a host reloads and finds a retained snapshot). */
  function mergeStates(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    const poll = local.poll || remote.poll;
    const map = new Map();
    (remote.items || []).forEach(function (it) { if (it && it.id) map.set(it.id, it); });
    (local.items || []).forEach(function (it) {
      if (!it || !it.id) return;
      const prev = map.get(it.id);
      if (!prev || (it.ts || 0) >= (prev.ts || 0)) map.set(it.id, it);
    });
    const items = Array.from(map.values()).sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    return {
      v: 1,
      code: local.code || remote.code,
      poll: poll,
      items: items,
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    };
  }

  function aggregate(state) {
    const poll = (state && state.poll) || null;
    const items = (state && state.items) || [];
    const out = { type: poll ? poll.type : null, total: items.length, items: items };
    if (!poll) return out;

    if (poll.type === 'choice') {
      const counts = poll.options.map(function () { return 0; });
      items.forEach(function (it) { if (Number.isInteger(it.opt) && counts[it.opt] != null) counts[it.opt]++; });
      out.counts = counts;
      out.max = Math.max.apply(null, counts.concat([1]));
      return out;
    }
    if (poll.type === 'rating') {
      const counts = [0, 0, 0, 0, 0];
      let sum = 0;
      items.forEach(function (it) {
        if (it.opt >= 1 && it.opt <= 5) { counts[it.opt - 1]++; sum += it.opt; }
      });
      out.counts = counts;
      out.max = Math.max.apply(null, counts.concat([1]));
      out.average = counts.reduce(function (a, c) { return a + c; }, 0) ? sum / counts.reduce(function (a, c) { return a + c; }, 0) : 0;
      return out;
    }
    if (poll.type === 'word') {
      const freq = new Map();
      items.forEach(function (it) {
        const key = (it.text || '').toLowerCase();
        if (!key) return;
        const cur = freq.get(key) || { word: it.text, count: 0 };
        cur.count++;
        freq.set(key, cur);
      });
      const words = Array.from(freq.values()).sort(function (a, b) { return b.count - a.count; }).slice(0, 60);
      out.words = words;
      out.maxWord = words.length ? words[0].count : 1;
      return out;
    }
    out.recent = items.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return out;
  }

  function pct(n, total) {
    if (!total) return 0;
    return Math.round((n / total) * 100);
  }

  function toCSV(state) {
    const poll = (state && state.poll) || {};
    const rows = [['time', 'name', 'answer']];
    ((state && state.items) || []).forEach(function (it) {
      let ans = it.text || '';
      if (poll.type === 'choice' && Number.isInteger(it.opt)) ans = (poll.options || [])[it.opt] || '';
      if (poll.type === 'rating' && it.opt) ans = String(it.opt);
      const t = new Date(it.ts || Date.now());
      rows.push([t.toISOString(), it.name || '', ans]);
    });
    const esc = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    return '\ufeff' + rows.map(function (r) { return r.map(esc).join(','); }).join('\r\n');
  }

  function timeLabel(ts) {
    const d = new Date(ts || Date.now());
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  return {
    ALPHABET: ALPHABET,
    TOPIC_PREFIX: TOPIC_PREFIX,
    makeCode: makeCode,
    makeId: makeId,
    normalizeCode: normalizeCode,
    topics: topics,
    emptyState: emptyState,
    normalizePoll: normalizePoll,
    sanitizeText: sanitizeText,
    applyResponse: applyResponse,
    mergeStates: mergeStates,
    aggregate: aggregate,
    pct: pct,
    toCSV: toCSV,
    timeLabel: timeLabel,
  };
});
