/* Projector screen: owns the session state and renders live results. */
(function () {
  'use strict';
  const C = window.PollCore;
  const N = window.Net;

  const params = new URLSearchParams(location.search);
  const code = C.normalizeCode(params.get('c') || '');
  if (!code) { location.replace('index.html'); return; }

  const T = C.topics(code);
  const POLL_KEY = 'livedot.poll.' + code;

  let state = C.emptyState(code);
  try {
    const saved = JSON.parse(localStorage.getItem(POLL_KEY) || 'null');
    if (saved) state.poll = C.normalizePoll(saved);
  } catch (e) { /* ignore */ }

  const $ = function (id) { return document.getElementById(id); };
  const qEl = $('question');
  const resultsEl = $('results');
  const countEl = $('count');
  const statusEl = $('status');
  const typeTag = $('typeTag');
  const qrSvg = $('qr');
  const qrbox = $('qrbox');
  const joinUrlEl = $('joinUrl');
  const footUrlEl = $('footUrl');
  const codeText = $('codeText');
  const btnResults = $('btnResults');
  const btnCsv = $('btnCsv');
  const btnClear = $('btnClear');
  const btnFull = $('btnFull');

  const TYPE_LABEL = { word: '文字雲', choice: '選擇題', open: '開放回答', rating: '五星評分' };

  /* ---------- join url + QR ---------- */
  const joinURL = new URL('vote.html?c=' + code, location.href).href;
  const baseURL = new URL('.', location.href).href;
  codeText.textContent = code;
  joinUrlEl.textContent = joinURL.replace(/^https?:\/\//, '');
  footUrlEl.textContent = baseURL.replace(/^https?:\/\//, '');
  try { N.renderQR(qrSvg, joinURL); } catch (e) { console.warn('QR failed', e); }

  /* ---------- transport ---------- */
  const client = N.createClient('host');
  let adopted = false;
  let pending = [];
  let renderQueued = false;
  let publishTimer = null;

  client.on('connect', function () {
    N.setStatus(statusEl, 'live', '已連線 · 即時同步');
    client.subscribe(T.resp, { qos: 1 });
    client.subscribe(T.state, { qos: 1 });
    setTimeout(function () {
      if (!adopted) {
        adopted = true;
        flushPending();
        publishState();
        render();
      }
    }, 1400);
  });
  client.on('reconnect', function () { N.setStatus(statusEl, null, '重新連線中…'); });
  client.on('close', function () { N.setStatus(statusEl, 'off', '已離線'); });
  client.on('error', function () { N.setStatus(statusEl, 'off', '連線不穩，重試中…'); });

  client.on('message', function (topic, payload) {
    if (topic === T.state) { onRemoteState(payload); return; }
    if (topic === T.resp) { onResponse(payload); }
  });

  function parse(buf) {
    try { return JSON.parse(buf.toString()); } catch (e) { return null; }
  }

  function onResponse(buf) {
    const rec = parse(buf);
    if (!rec) return;
    if (!adopted || !state.poll) { pending.push(rec); if (pending.length > 300) pending.shift(); return; }
    const before = state.items.length;
    state = C.applyResponse(state, rec);
    if (state.items.length === before && !changedExisting(rec)) return;
    scheduleRender();
    schedulePublish();
  }

  function changedExisting(rec) {
    return state.items.some(function (it) { return it.id === rec.id; });
  }

  function flushPending() {
    const list = pending; pending = [];
    list.forEach(function (rec) {
      if (state.poll) state = C.applyResponse(state, rec);
    });
  }

  function onRemoteState(buf) {
    const remote = parse(buf);
    if (!remote || remote.v !== 1) return;
    if (remote.updatedAt && remote.updatedAt === state.updatedAt) return; // our own echo

    if (!adopted) {
      adopted = true;
      state = C.mergeStates(state, remote);
      if (!state.poll) state.poll = C.normalizePoll(remote.poll);
      flushPending();
      render();
      publishState();
      return;
    }
    if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
      state = C.mergeStates(state, remote);
      render();
    }
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    // setTimeout rather than rAF: rAF is paused in background tabs, which would
    // leave the projector screen stale if the window is not focused.
    setTimeout(function () { renderQueued = false; render(); }, 16);
  }

  function schedulePublish() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(publishState, 320);
  }

  function publishState() {
    if (!state.poll) return;
    state.updatedAt = Date.now();
    try { localStorage.setItem(POLL_KEY, JSON.stringify(state.poll)); } catch (e) { /* ignore */ }
    client.publish(T.state, JSON.stringify({
      v: 1, code: code, poll: state.poll, items: state.items, updatedAt: state.updatedAt,
    }), { qos: 1, retain: true });
  }

  /* ---------- rendering ---------- */
  let currentType = null;
  let emptyShown = false;
  let skel = {};

  function setEmpty(text, sub) {
    resultsEl.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'empty';
    const icon = document.createElement('div');
    icon.className = 'big';
    icon.textContent = '💬';
    const b = document.createElement('b');
    b.textContent = text;
    const p = document.createElement('div');
    p.textContent = sub || '';
    box.appendChild(icon); box.appendChild(b); box.appendChild(p);
    resultsEl.appendChild(box);
    emptyShown = true;
    skel = {};
    currentType = null;
  }

  function render() {
    const poll = state.poll;
    if (!poll) {
      setEmpty('找不到這場投票', '請回到建立頁面重新開始，或確認代碼是否正確。');
      return;
    }
    qEl.textContent = poll.q;
    typeTag.textContent = TYPE_LABEL[poll.type] || '即時投票';
    countEl.textContent = state.items.length;
    btnResults.textContent = poll.showResults ? '隱藏觀眾結果' : '顯示觀眾結果';

    if (state.items.length === 0) {
      setEmpty('等待第一位回應…', '把 QR code 給大家掃描，或說出加入代碼 ' + code);
      return;
    }
    if (emptyShown) {
      emptyShown = false;
      resultsEl.innerHTML = '';
      currentType = null;
      skel = {};
    }
    if (currentType !== poll.type) {
      resultsEl.innerHTML = '';
      skel = {};
      currentType = poll.type;
    }

    const agg = C.aggregate(state);
    if (poll.type === 'choice') renderChoice(agg, poll);
    else if (poll.type === 'rating') renderRating(agg, poll);
    else if (poll.type === 'word') renderWord(agg, poll);
    else renderOpen(agg, poll);
  }

  function renderChoice(agg, poll) {
    if (!skel.rows || skel.rows.length !== poll.options.length) {
      resultsEl.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'bars';
      skel.rows = poll.options.map(function (opt, i) {
        const row = document.createElement('div');
        row.className = 'bar-row';
        const top = document.createElement('div');
        top.className = 'bar-top';
        const b = document.createElement('b');
        b.textContent = opt;
        const s = document.createElement('span');
        top.appendChild(b); top.appendChild(s);
        const track = document.createElement('div');
        track.className = 'bar-track';
        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        track.appendChild(fill);
        row.appendChild(top); row.appendChild(track);
        wrap.appendChild(row);
        return { row: row, label: b, meta: s, fill: fill };
      });
      resultsEl.appendChild(wrap);
    }
    skel.rows.forEach(function (r, i) {
      const n = agg.counts[i] || 0;
      const p = C.pct(n, agg.total);
      r.fill.style.width = (agg.total ? Math.max(p, n > 0 ? 2 : 0) : 0) + '%';
      r.meta.textContent = n + ' 票 · ' + p + '%';
      r.label.style.opacity = n === 0 ? 0.65 : 1;
    });
  }

  function renderRating(agg, poll) {
    if (!skel.rating) {
      resultsEl.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'rating-wrap';

      const left = document.createElement('div');
      left.style.textAlign = 'center';
      const avg = document.createElement('div');
      avg.className = 'avg-num';
      const stars = document.createElement('div');
      stars.style.fontSize = '20px';
      stars.style.letterSpacing = '4px';
      const lbl = document.createElement('div');
      lbl.className = 'avg-lbl';
      left.appendChild(avg); left.appendChild(stars); left.appendChild(lbl);

      const right = document.createElement('div');
      const rows = [5, 4, 3, 2, 1].map(function (v) {
        const row = document.createElement('div');
        row.className = 'rating-bar';
        const k = document.createElement('div');
        k.className = 'rk';
        k.textContent = v;
        const track = document.createElement('div');
        track.className = 'bar-track';
        track.style.height = '18px';
        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        track.appendChild(fill);
        const ct = document.createElement('div');
        ct.className = 'rk2';
        row.appendChild(k); row.appendChild(track); row.appendChild(ct);
        right.appendChild(row);
        return { value: v, fill: fill, ct: ct };
      });

      wrap.appendChild(left); wrap.appendChild(right);
      resultsEl.appendChild(wrap);
      skel.rating = { avg: avg, stars: stars, lbl: lbl, rows: rows };
    }

    const total = agg.counts.reduce(function (a, b) { return a + b; }, 0);
    const value = total ? agg.average : 0;
    skel.rating.avg.textContent = total ? value.toFixed(1) : '—';
    skel.rating.lbl.textContent = total ? total + ' 人評分 · 滿分 5' : '尚無評分';
    const full = Math.round(value);
    skel.rating.stars.textContent = '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
    skel.rating.rows.forEach(function (r) {
      const n = agg.counts[r.value - 1] || 0;
      r.fill.style.width = (agg.max ? (n / agg.max) * 100 : 0) + '%';
      r.ct.textContent = n + ' (' + C.pct(n, total) + '%)';
    });
  }

  function renderWord(agg, poll) {
    if (!skel.cloud) {
      resultsEl.innerHTML = '';
      skel.cloud = document.createElement('div');
      skel.cloud.className = 'cloud';
      skel.map = new Map();
      resultsEl.appendChild(skel.cloud);
    }
    const live = new Set();
    agg.words.forEach(function (w) {
      live.add(w.word.toLowerCase());
      let span = skel.map.get(w.word.toLowerCase());
      if (!span) {
        span = document.createElement('span');
        span.textContent = w.word;
        skel.cloud.appendChild(span);
        skel.map.set(w.word.toLowerCase(), span);
      }
      const ratio = w.count / agg.maxWord;
      span.style.fontSize = (1.05 + ratio * 3.3).toFixed(2) + 'rem';
      span.style.color = ratio > 0.66 ? '#ffffff' : N.colorFor(w.word);
      span.style.opacity = String(0.55 + ratio * 0.45);
      span.title = w.count + ' 次';
    });
    skel.map.forEach(function (span, key) {
      if (!live.has(key)) { span.remove(); skel.map.delete(key); }
    });
  }

  function renderOpen(agg, poll) {
    if (!skel.cards) {
      resultsEl.innerHTML = '';
      skel.cards = document.createElement('div');
      skel.cards.className = 'cards';
      skel.seen = new Map();
      resultsEl.appendChild(skel.cards);
    }
    // drop removed
    const liveIds = new Set(agg.items.map(function (i) { return i.id; }));
    skel.seen.forEach(function (node, id) {
      if (!liveIds.has(id)) { node.remove(); skel.seen.delete(id); }
    });
    // prepend new ones (newest first)
    agg.recent.slice(0, 80).forEach(function (item, idx) {
      if (skel.seen.has(item.id)) return;
      const card = document.createElement('div');
      card.className = 'msg';
      const who = document.createElement('div');
      who.className = 'who';
      const av = document.createElement('span');
      av.className = 'av';
      av.textContent = (item.name || '匿').slice(0, 1).toUpperCase();
      const nm = document.createElement('span');
      nm.textContent = item.name || '匿名';
      const tm = document.createElement('span');
      tm.textContent = '· ' + C.timeLabel(item.ts);
      tm.style.opacity = '0.75';
      who.appendChild(av); who.appendChild(nm); who.appendChild(tm);
      const p = document.createElement('p');
      p.textContent = item.text;
      card.appendChild(who); card.appendChild(p);
      const anchor = skel.cards.children[idx] || null;
      skel.cards.insertBefore(card, anchor);
      skel.seen.set(item.id, card);
    });
  }

  /* ---------- controls ---------- */
  btnResults.addEventListener('click', function () {
    if (!state.poll) return;
    state.poll.showResults = !state.poll.showResults;
    btnResults.textContent = state.poll.showResults ? '隱藏觀眾結果' : '顯示觀眾結果';
    publishState();
    N.toast(state.poll.showResults ? '觀眾現在可以看到即時結果' : '觀眾已隱藏結果');
  });

  btnCsv.addEventListener('click', function () {
    if (!state.items.length) { N.toast('還沒有回應可以匯出'); return; }
    N.download('livedot-' + code + '.csv', C.toCSV(state));
    N.toast('已匯出 ' + state.items.length + ' 筆回應');
  });

  btnClear.addEventListener('click', function () {
    if (!state.items.length) { N.toast('目前沒有回應'); return; }
    if (!confirm('確定清除全部 ' + state.items.length + ' 筆回應？此動作無法復原。')) return;
    state.items = [];
    state.updatedAt = Date.now();
    publishState();
    render();
    N.toast('已清除所有回應');
  });

  btnFull.addEventListener('click', function () {
    if (!document.fullscreenElement) {
      (document.documentElement.requestFullscreen || function () {}).call(document.documentElement);
    } else {
      document.exitFullscreen();
    }
  });

  qrbox.addEventListener('click', function () {
    const overlay = document.createElement('div');
    overlay.className = 'zoom-overlay';
    const box = document.createElement('div');
    box.className = 'qrbox';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    N.renderQR(svg, joinURL);
    box.appendChild(svg);
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = '掃描加入 · 代碼 ' + code;
    overlay.appendChild(box);
    overlay.appendChild(cap);
    overlay.addEventListener('click', function () { overlay.remove(); });
    document.body.appendChild(overlay);
  });

  render();
  // If nothing arrives from localStorage, tell the user after a moment.
  setTimeout(function () {
    if (!state.poll) {
      setEmpty('找不到這場投票', '請回到建立頁面建立新的投票（代碼 ' + code + '）。');
    }
  }, 6000);
})();
