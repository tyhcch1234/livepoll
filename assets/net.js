/* LivePoll shared browser helpers: MQTT transport, QR rendering, small UI utils. */
(function () {
  'use strict';

  const BROKER = 'wss://broker.emqx.io:8084/mqtt';

  function createClient(role) {
    const clientId = 'livedot_' + role + '_' + Math.random().toString(36).slice(2, 10);
    return mqtt.connect(BROKER, {
      clientId: clientId,
      clean: true,
      protocolVersion: 4,
      keepalive: 30,
      reconnectPeriod: 1500,
      connectTimeout: 12000,
    });
  }

  function setStatus(el, kind, text) {
    if (!el) return;
    el.classList.remove('live', 'off');
    if (kind) el.classList.add(kind);
    const label = el.querySelector('em');
    if (label && text) label.textContent = text;
  }

  /** Build a crisp inline SVG QR code (no images, no network). */
  function renderQR(svg, text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 2;
    const size = n + quiet * 2;
    let path = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) path += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      }
    }
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '加入投票的 QR code');
    svg.innerHTML = '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + path + '" fill="#0b1020"/>';
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(function () { el.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { toast('已複製連結'); });
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已複製連結'); } catch (e) { toast('複製失敗，請手動選取'); }
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  const PALETTE = ['#7c5cff', '#2ee6d6', '#ffb547', '#ff5c8a', '#5cc8ff', '#35d07f'];
  function colorFor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  window.Net = {
    BROKER: BROKER,
    createClient: createClient,
    setStatus: setStatus,
    renderQR: renderQR,
    toast: toast,
    copy: copy,
    download: download,
    el: el,
    colorFor: colorFor,
  };
})();
