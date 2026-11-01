/* Audience page: answer the question, then watch the live tally. */
(function () {
  'use strict';
  const C = window.PollCore;
  const N = window.Net;

  const params = new URLSearchParams(location.search);
  const code = C.normalizeCode(params.get('c') || '');
  if (!code) { location.replace('index.html#join'); return; }

  const T = C.topics(code);
  const ID_KEY = 'livedot.id.' + code;

  const $ = function (id) { return document.getElementById(id); };
  const statusEl = $('status');
  const loadingEl = $('loading');
  const bodyEl = $('body');
  const errorEl = $('error');
  const qEl = $('question');
  const metaEl = $('meta');
  const formEl = $('form');
  const doneEl = $('done');
  const mineEl = $('mine');
  const pplEl = $('ppl');
  const nameField = $('nameField');
  const nameLabel = $('nameLabel');
  const nameEl = $('name');
  const answerArea = $('answerArea');
  const submitBtn = $('submit');
  const formHint = $('formHint');
  const editBtn = $('edit');
  const miniEl = $('mini');
  const miniBody = $('miniBody');

  const TYPE_LABEL = { word: '文字雲', choice: '選擇題', open: '開放回答', rating: '五星評分' };
  const RATING_WORDS = ['很差', '較差', '一般', '好', '非常好'];

  let myId;
  try { myId = localStorage.getItem(ID_KEY); } catch (e) { myId = null; }
  if (!myId) {
    myId = C.makeId();
    try { localStorage.setItem(ID_KEY, myId); } catch (e) { /* ignore */ }
  }

  let poll = null;
  let items = [];
  let draft = { opt: null, text: '' };
  let editing = false;
  let optimisticUntil = 0;
  let lastSubmit = 0;
  let builtType = null;
  let timeoutHit = false;

  try { nameEl.value = localStorage.getItem('livedot.name') || ''; } catch (e) { /* ignore */ }

  /* ---------- connection ---------- */
  const client = N.createClient('vote');
  client.on('connect', function () {
    N.setStatus(statusEl, 'live', '已連線');
    client.subscribe(T.state, { qos: 1 });
  });
  client.on('reconnect', function () { N.setStatus(statusEl, null, '重新連線中…'); });
  client.on('close', function () { N.setStatus(statusEl, 'off', '已離線'); });
  client.on('error', function () { N.setStatus(statusEl, 'off', '連線不穩，重試中…'); });

  client.on('message', function (topic, payload) {
    if (topic !== T.state) return;
    let remote;
    try { remote = JSON.parse(payload.toString()); } catch (e) { return; }
    if (!remote || remote.v !== 1) return;
    const nextPoll = C.normalizePoll(remote.poll);
    if (nextPoll) poll = nextPoll;
    items = Array.isArray(remote.items) ? remote.items : [];
    render();
  });

  /* ---------- state helpers ---------- */
  function isSubmitted() {
    if (items.some(function (i) { return i.id === myId; })) return true;
    return Date.now() < optimisticUntil;
  }

  function myRecord() {
    return items.find(function (i) { return i.id === myId; }) || null;
  }

  function answerLabel(rec) {
    if (!rec || !poll) return '';
    if (poll.type === 'choice') return poll.options[rec.opt] || '—';
    if (poll.type === 'rating') return rec.opt + ' 分（' + (RATING_WORDS[rec.opt - 1] || '') + '）';
    return rec.text || '';
  }

  /* ---------- render ---------- */
  function render() {
    timeoutHit = false;
    loadingEl.hidden = true;
    errorEl.hidden = true;
    bodyEl.hidden = false;

    if (!poll) {
      bodyEl.hidden = true;
      loadingEl.hidden = false;
      return;
    }

    qEl.textContent = poll.q;
    metaEl.textContent = TYPE_LABEL[poll.type] + (poll.nameRequired ? ' · 需要填寫名字' : ' · 可匿名作答');
    nameField.hidden = poll.type === 'choice' || poll.type === 'rating' ? false : false;
    nameLabel.textContent = poll.nameRequired ? '你的名字（必填）' : '你的名字（選填）';

    if (builtType !== poll.type) {
      buildAnswerArea();
      builtType = poll.type;
    }

    const submitted = isSubmitted() && !editing;
    formEl.hidden = submitted;
    doneEl.hidden = !submitted;
    submitBtn.disabled = false;

    if (submitted) {
      const rec = myRecord();
      mineEl.textContent = rec ? answerLabel(rec) : (draft.text || (draft.opt ? draft.opt + ' 分' : '已送出'));
      pplEl.textContent = '已有 ' + items.length + ' 人回應';
    } else {
      syncForm();
    }

    // live results preview
    const showMini = poll.showResults && items.length > 0;
    miniEl.hidden = !showMini;
    if (showMini) renderMini();

    document.title = poll.q.slice(0, 24) + ' · LivePoll';
  }

  function buildAnswerArea() {
    answerArea.innerHTML = '';
    draft = { opt: null, text: '' };

    if (poll.type === 'choice') {
      const wrap = document.createElement('div');
      wrap.className = 'opt-btns';
      poll.options.forEach(function (opt, i) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'opt-btn';
        b.dataset.opt = String(i);
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = String.fromCharCode(65 + i);
        const t = document.createElement('span');
        t.textContent = opt;
        b.appendChild(n); b.appendChild(t);
        b.addEventListener('click', function () {
          if (poll.nameRequired && !nameEl.value.trim()) {
            nameEl.focus();
            N.toast('請先填寫名字');
            return;
          }
          draft.opt = i;
          syncForm();
          setTimeout(submit, 140);
        });
        wrap.appendChild(b);
      });
      answerArea.appendChild(wrap);
      submitBtn.hidden = true;
      formHint.textContent = '點一下選項即會自動送出';
    } else if (poll.type === 'rating') {
      const wrap = document.createElement('div');
      wrap.className = 'stars';
      [1, 2, 3, 4, 5].forEach(function (v) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'star-btn';
        b.dataset.opt = String(v);
        b.textContent = String(v);
        const s = document.createElement('small');
        s.textContent = RATING_WORDS[v - 1];
        b.appendChild(s);
        b.addEventListener('click', function () {
          if (poll.nameRequired && !nameEl.value.trim()) {
            nameEl.focus();
            N.toast('請先填寫名字');
            return;
          }
          draft.opt = v;
          syncForm();
          setTimeout(submit, 140);
        });
        wrap.appendChild(b);
      });
      answerArea.appendChild(wrap);
      submitBtn.hidden = true;
      formHint.textContent = '點一下分數即會自動送出';
    } else {
      const isWord = poll.type === 'word';
      const input = document.createElement(isWord ? 'input' : 'textarea');
      input.className = isWord ? 'input' : 'textarea';
      input.id = 'answerInput';
      input.maxLength = isWord ? 24 : 140;
      input.placeholder = isWord ? '一個詞，例如：開心' : '寫下你的想法…';
      input.addEventListener('input', function () {
        draft.text = input.value;
        updateCount();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (isWord || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      });
      answerArea.appendChild(input);

      const counter = document.createElement('div');
      counter.className = 'hint';
      counter.id = 'counter';
      counter.style.textAlign = 'right';
      counter.style.marginTop = '6px';
      answerArea.appendChild(counter);

      submitBtn.hidden = false;
      formHint.textContent = isWord ? '最多 24 個字' : '按 Enter 送出（Ctrl/⌘ + Enter）';
      updateCount();
    }
  }

  function updateCount() {
    const counter = document.getElementById('counter');
    const input = document.getElementById('answerInput');
    if (!counter || !input) return;
    counter.textContent = input.value.length + ' / ' + input.maxLength;
  }

  function syncForm() {
    document.querySelectorAll('.opt-btn, .star-btn').forEach(function (b) {
      const opt = b.dataset.opt;
      b.classList.toggle('sel', draft.opt != null && String(draft.opt) === opt);
    });
    const input = document.getElementById('answerInput');
    if (input && draft.text && input.value !== draft.text) input.value = draft.text;
    updateCount();
  }

  function renderMini() {
    miniBody.innerHTML = '';
    const agg = C.aggregate({ poll: poll, items: items });

    if (poll.type === 'choice') {
      poll.options.forEach(function (opt, i) {
        const row = document.createElement('div');
        row.className = 'mini-row';
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = opt;
        const tr = document.createElement('span');
        tr.className = 'tr';
        const bar = document.createElement('i');
        bar.style.width = C.pct(agg.counts[i], agg.total) + '%';
        tr.appendChild(bar);
        const ct = document.createElement('span');
        ct.className = 'ct';
        ct.textContent = agg.counts[i];
        row.appendChild(nm); row.appendChild(tr); row.appendChild(ct);
        miniBody.appendChild(row);
      });
    } else if (poll.type === 'rating') {
      const p = document.createElement('div');
      p.className = 'mini-row';
      p.innerHTML = '';
      const avg = document.createElement('b');
      avg.style.fontSize = '26px';
      avg.textContent = agg.average ? agg.average.toFixed(1) : '—';
      const txt = document.createElement('span');
      txt.className = 'nm';
      txt.textContent = '平均分 · ' + agg.total + ' 人評分';
      p.appendChild(avg); p.appendChild(txt);
      miniBody.appendChild(p);
    } else if (poll.type === 'word') {
      const cloud = document.createElement('div');
      cloud.className = 'cloud';
      cloud.style.minHeight = '0';
      cloud.style.padding = '6px 0';
      cloud.style.gap = '6px 12px';
      agg.words.slice(0, 8).forEach(function (w) {
        const s = document.createElement('span');
        s.textContent = w.word;
        s.style.fontSize = (0.95 + (w.count / agg.maxWord) * 0.7).toFixed(2) + 'rem';
        s.style.color = N.colorFor(w.word);
        cloud.appendChild(s);
      });
      miniBody.appendChild(cloud);
    } else {
      agg.recent.slice(0, 3).forEach(function (item) {
        const row = document.createElement('div');
        row.className = 'mini-row';
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = (item.name ? item.name + '：' : '') + item.text;
        row.appendChild(nm);
        miniBody.appendChild(row);
      });
    }
  }

  /* ---------- submit ---------- */
  function submit() {
    if (!poll) return;
    if (Date.now() - lastSubmit < 700) return;

    const name = C.sanitizeText(nameEl.value, 24);
    if (poll.nameRequired && !name) {
      nameEl.focus();
      N.toast('這場投票需要填寫名字');
      return;
    }

    const rec = { id: myId, name: name, ts: Date.now(), opt: null, text: null };
    if (poll.type === 'choice' || poll.type === 'rating') {
      if (draft.opt == null) { N.toast('請先選擇一個答案'); return; }
      rec.opt = draft.opt;
    } else {
      const input = document.getElementById('answerInput');
      const text = C.sanitizeText(input ? input.value : draft.text, poll.maxLen || 140);
      if (!text) { input && input.focus(); N.toast('請先輸入內容'); return; }
      rec.text = text;
      draft.text = text;
    }

    if (!client.connected) { N.toast('尚未連線，請等一秒再試'); return; }

    try { localStorage.setItem('livedot.name', name); } catch (e) { /* ignore */ }

    client.publish(T.resp, JSON.stringify(rec), { qos: 1 });
    lastSubmit = Date.now();
    optimisticUntil = Date.now() + 9000;
    editing = false;
    // reflect locally right away, host state will confirm shortly
    items = items.filter(function (i) { return i.id !== myId; }).concat([rec]);
    render();
  }

  submitBtn.addEventListener('click', submit);

  nameEl.addEventListener('input', function () {
    try { localStorage.setItem('livedot.name', nameEl.value); } catch (e) { /* ignore */ }
  });

  editBtn.addEventListener('click', function () {
    editing = true;
    const rec = myRecord();
    if (rec) {
      draft.opt = rec.opt != null ? rec.opt : draft.opt;
      draft.text = rec.text || draft.text;
    }
    render();
  });

  /* ---------- boot ---------- */
  setTimeout(function () {
    if (!poll && !timeoutHit) {
      timeoutHit = true;
      loadingEl.hidden = true;
      bodyEl.hidden = true;
      errorEl.hidden = false;
      N.setStatus(statusEl, 'off', '未找到投票');
    }
  }, 9000);
})();
