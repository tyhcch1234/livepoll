/* Landing page: build a poll, then hand off to the host screen. */
(function () {
  'use strict';
  const C = window.PollCore;

  const qEl = document.getElementById('q');
  const typesEl = document.getElementById('types');
  const optionsBlock = document.getElementById('optionsBlock');
  const optRows = document.getElementById('optRows');
  const addOpt = document.getElementById('addOpt');
  const nameReq = document.getElementById('nameReq');
  const showRes = document.getElementById('showRes');
  const createBtn = document.getElementById('create');
  const joinCode = document.getElementById('joinCode');
  const joinBtn = document.getElementById('joinBtn');
  const recent = document.getElementById('recent');

  const DEFAULTS = { choice: ['選項 1', '選項 2', '選項 3'], word: [], open: [], rating: [] };

  function currentType() {
    const checked = typesEl.querySelector('input[name="type"]:checked');
    return checked ? checked.value : 'word';
  }

  function addRow(value) {
    if (optRows.children.length >= 8) return;
    const row = document.createElement('div');
    row.className = 'opt-row';

    const input = document.createElement('input');
    input.className = 'input';
    input.maxLength = 60;
    input.placeholder = '選項 ' + (optRows.children.length + 1);
    input.value = value || '';

    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.type = 'button';
    rm.textContent = '×';
    rm.title = '刪除選項';
    rm.addEventListener('click', function () {
      if (optRows.children.length <= 2) return;
      row.remove();
      syncRemoveButtons();
    });

    row.appendChild(input);
    row.appendChild(rm);
    optRows.appendChild(row);
    syncRemoveButtons();
  }

  function syncRemoveButtons() {
    const rows = Array.from(optRows.children);
    rows.forEach(function (r) {
      r.querySelector('.rm').disabled = rows.length <= 2;
      r.querySelector('.rm').style.opacity = rows.length <= 2 ? 0.35 : 1;
    });
  }

  function resetOptions(type) {
    optRows.innerHTML = '';
    const defaults = DEFAULTS[type] || [];
    if (type === 'choice') defaults.forEach(addRow);
  }

  typesEl.addEventListener('change', function () {
    const type = currentType();
    optionsBlock.hidden = type !== 'choice';
    resetOptions(type);
    createBtn.textContent = type === 'choice' ? '建立投票並取得 QR code' : '建立投票並取得 QR code';
  });

  addOpt.addEventListener('click', function () { addRow(''); });

  function saveRecent(entry) {
    try {
      const key = 'livedot.recent';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      const next = [entry].concat(list.filter(function (x) { return x.code !== entry.code; })).slice(0, 4);
      localStorage.setItem(key, JSON.stringify(next));
    } catch (e) { /* storage may be blocked */ }
  }

  function renderRecent() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('livedot.recent') || '[]'); } catch (e) { list = []; }
    if (!list.length) { recent.innerHTML = ''; return; }
    recent.textContent = '最近的投票：';
    list.slice(0, 3).forEach(function (item, i) {
      const a = document.createElement('a');
      a.href = 'host.html?c=' + encodeURIComponent(item.code);
      a.textContent = (i ? ' · ' : ' ') + (item.q || '未命名').slice(0, 14) + '（' + item.code + '）';
      recent.appendChild(a);
    });
  }

  createBtn.addEventListener('click', function () {
    const text = C.sanitizeText(qEl.value, 180);
    if (!text) {
      qEl.focus();
      qEl.style.borderColor = 'rgba(255,92,138,0.85)';
      setTimeout(function () { qEl.style.borderColor = ''; }, 1400);
      return;
    }
    const type = currentType();
    let options = [];
    if (type === 'choice') {
      options = Array.from(optRows.querySelectorAll('input'))
        .map(function (i) { return C.sanitizeText(i.value, 60); })
        .filter(Boolean);
      if (options.length < 2) {
        window.Net && window.Net.toast ? window.Net.toast('選擇題至少需要 2 個選項') : alert('選擇題至少需要 2 個選項');
        return;
      }
    }

    const poll = C.normalizePoll({
      q: text,
      type: type,
      options: options,
      nameRequired: nameReq.checked,
      showResults: showRes.checked,
    });

    const code = C.makeCode(6);
    try {
      localStorage.setItem('livedot.poll.' + code, JSON.stringify(poll));
    } catch (e) { /* ignore */ }
    saveRecent({ code: code, q: poll.q, ts: Date.now() });
    location.href = 'host.html?c=' + code;
  });

  qEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') createBtn.click();
  });

  function goJoin() {
    const code = C.normalizeCode(joinCode.value);
    if (code.length < 4) {
      joinCode.focus();
      if (window.Net) window.Net.toast('請輸入 6 位加入代碼');
      return;
    }
    location.href = 'vote.html?c=' + code;
  }
  joinBtn.addEventListener('click', goJoin);
  joinCode.addEventListener('keydown', function (e) { if (e.key === 'Enter') goJoin(); });

  resetOptions('word');
  renderRecent();
  qEl.focus();
})();
