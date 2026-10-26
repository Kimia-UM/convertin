(function () {
  'use strict';

  /* ---------- Theme ---------- */
  var root = document.documentElement;
  var stored = localStorage.getItem('docforge-theme');
  var initial = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', initial);
  document.getElementById('themeToggle').addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('docforge-theme', next);
  });
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Toast ---------- */
  var toasts = document.getElementById('toasts');
  var ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  function toast(type, title, msg) {
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<span class="ti">' + (ICONS[type] || ICONS.info) + '</span>' +
      '<div class="tx"><div class="tt"></div><div class="tm"></div></div>' +
      '<button class="tc" aria-label="Tutup"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    el.querySelector('.tt').textContent = title;
    el.querySelector('.tm').textContent = msg || '';
    function dismiss() {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 250);
    }
    el.querySelector('.tc').addEventListener('click', dismiss);
    toasts.appendChild(el);
    setTimeout(dismiss, 4800);
  }

  /* ---------- Helpers ---------- */
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function ext(name) { var i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i + 1).toUpperCase().slice(0, 4) : ''; }

  /* ---------- Tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab[role="tab"]'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
  function selectTab(name) {
    tabs.forEach(function (t) {
      var on = t.dataset.tool === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach(function (p) {
      var on = p.dataset.tool === name;
      p.classList.toggle('active', on);
      if (on) { p.removeAttribute('hidden'); } else { p.setAttribute('hidden', ''); }
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () {
      selectTab(t.dataset.tool);
      history.replaceState(null, '', '#' + t.dataset.tool);
    });
    t.addEventListener('keydown', function (e) {
      var k = e.key;
      var d = (k === 'ArrowRight' || k === 'ArrowDown') ? 1 : (k === 'ArrowLeft' || k === 'ArrowUp') ? -1 : 0;
      if (d) { e.preventDefault(); var n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); selectTab(n.dataset.tool); history.replaceState(null, '', '#' + n.dataset.tool); }
    });
  });
  function selectFromHash() {
    var name = window.location.hash.slice(1);
    if (tabs.some(function (tab) { return tab.dataset.tool === name; })) selectTab(name);
  }
  window.addEventListener('hashchange', selectFromHash);
  selectFromHash();

  /* ---------- Tool controller ---------- */
  function badgeClass(name) {
    var e = ext(name).toLowerCase();
    if (e === 'pdf') return ['pdf', 'PDF'];
    if (e === 'doc' || e === 'docx') return ['doc', 'DOC'];
    return ['pdf', ext(name) || 'FILE'];
  }

  function makeTool(panel) {
    var cfg = {
      endpoint: panel.dataset.endpoint,
      label: panel.dataset.label || 'Proses',
      min: parseInt(panel.dataset.min, 10) || 1,
      defaultName: panel.dataset.default || 'output.zip',
      orderable: panel.hasAttribute('data-order'),
      stats: panel.hasAttribute('data-stats'),
      accept: (panel.dataset.accept || '').split(',').map(function (s) { return s.trim().replace(/^\./, '').toLowerCase(); }).filter(Boolean)
    };
    var input = panel.querySelector('input[type=file]');
    var dz = panel.querySelector('.dropzone');
    var listWrap = panel.querySelector('.filelist');
    var btn = panel.querySelector('.btn');
    var btnLabel = panel.querySelector('.btn-label');
    var progress = panel.querySelector('.progress');
    var hint = panel.querySelector('.hint');
    var optEls = Array.prototype.slice.call(panel.querySelectorAll('[data-param]'));
    var files = [];

    // Live value label for range inputs
    panel.querySelectorAll('input[type=range][data-param]').forEach(function (r) {
      var out = r.closest('.opt') && r.closest('.opt').querySelector('.val');
      if (out) r.addEventListener('input', function () { out.textContent = r.value; });
    });

    var dragEl = null;

    function getAfter(container, y) {
      var els = Array.prototype.slice.call(container.querySelectorAll('.file:not(.dragging)'));
      var closest = { offset: -Infinity, el: null };
      els.forEach(function (el) {
        var box = el.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset: offset, el: el };
      });
      return closest.el;
    }

    function wireDrag() {
      var ul = listWrap.querySelector('.files');
      if (!ul || !cfg.orderable) return;
      ul.addEventListener('dragstart', function (e) {
        var li = e.target && e.target.closest ? e.target.closest('.file') : null;
        if (!li) return;
        dragEl = li;
        li.classList.add('dragging');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', ''); } catch (_) {} }
      });
      ul.addEventListener('dragover', function (e) {
        if (!dragEl) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        var after = getAfter(ul, e.clientY);
        if (after == null) ul.appendChild(dragEl);
        else if (after !== dragEl) ul.insertBefore(dragEl, after);
      });
      ul.addEventListener('drop', function (e) { if (dragEl) e.preventDefault(); });
      ul.addEventListener('dragend', function () {
        if (!dragEl) return;
        dragEl.classList.remove('dragging');
        dragEl = null;
        var order = Array.prototype.map.call(ul.querySelectorAll('.file'), function (li) { return +li.dataset.index; });
        var nf = [];
        order.forEach(function (oi) { if (files[oi]) nf.push(files[oi]); });
        if (nf.length === files.length) { files = nf; render(); }
      });
    }

    function render() {
      if (!files.length) {
        listWrap.classList.remove('show');
        listWrap.innerHTML = '';
      } else {
        var total = files.reduce(function (s, f) { return s + f.size; }, 0);
        var rows = files.map(function (f, i) {
          var b = badgeClass(f.name);
          var grip = cfg.orderable ? '<span class="drag-handle" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>' : '';
          var order = cfg.orderable ? '<span class="order-tag">#' + (i + 1) + '</span>' : '';
          return '<li class="file' + (cfg.orderable ? ' sortable' : '') + '" data-index="' + i + '"' + (cfg.orderable ? ' draggable="true"' : '') + '>' +
            grip +
            '<span class="ftype ' + b[0] + '">' + b[1] + '</span>' +
            '<div class="fmeta"><div class="fn" title="' + esc(f.name) + '">' + esc(f.name) + '</div><div class="fs">' + fmtSize(f.size) + (cfg.orderable ? ' · ' + order : '') + '</div></div>' +
            '<button class="fremove" data-remove="' + i + '" title="Hapus" aria-label="Hapus file"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>' +
            '</li>';
        }).join('');
        var tip = cfg.orderable ? '<p class="list-tip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg> Seret baris untuk mengatur urutan</p>' : '';
        listWrap.innerHTML =
          tip +
          '<div class="list-head"><span class="count"><span class="num">' + files.length + '</span> file · <span class="total">' + fmtSize(total) + '</span></span>' +
          '<button class="linkbtn" data-clear>Hapus semua</button></div>' +
          '<ul class="files">' + rows + '</ul>';
        listWrap.classList.add('show');
        wireDrag();
      }
      var enough = files.length >= cfg.min;
      btn.disabled = !enough;
      if (!files.length) { hint.textContent = ''; }
      else if (!enough) { hint.textContent = 'Tambahkan minimal ' + cfg.min + ' file untuk melanjutkan.'; }
      else { hint.textContent = ''; }
    }

    function addFiles(list) {
      var added = 0, rejected = 0;
      Array.prototype.forEach.call(list, function (f) {
        var e = ext(f.name).toLowerCase();
        if (cfg.accept.indexOf(e) === -1) { rejected++; return; }
        if (files.length >= 100) return;
        files.push(f); added++;
      });
      if (rejected) toast('info', 'Beberapa file dilewati', rejected + ' file bukan format yang didukung.');
      if (added) render();
    }

    input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); if (ev === 'dragleave' && dz.contains(e.relatedTarget)) return; dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });

    listWrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-clear]')) { files = []; render(); return; }
      var rm = e.target.closest('[data-remove]');
      if (rm) { files.splice(+rm.dataset.remove, 1); render(); }
    });

    btn.addEventListener('click', function () { run(); });

    function setLoading(on) {
      btn.classList.toggle('loading', on);
      progress.classList.toggle('on', on);
      btnLabel.textContent = on ? 'Memproses…' : cfg.label;
      if (on) { btn.disabled = true; } else { render(); }
    }
    function fileNameFrom(res) {
      var cd = res.headers.get('content-disposition') || '';
      var m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
      if (m) { try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; } }
      return cfg.defaultName;
    }

    async function run() {
      if (files.length < cfg.min) return;
      setLoading(true);
      var fd = new FormData();
      files.forEach(function (f) { fd.append('file', f, f.name); });
      optEls.forEach(function (el) {
        if (el.type === 'checkbox') { if (el.checked) fd.append(el.dataset.param, el.value || '1'); }
        else { fd.append(el.dataset.param, el.value); }
      });
      try {
        var res = await fetch(cfg.endpoint, { method: 'POST', body: fd });
        var ct = res.headers.get('content-type') || '';
        if (!res.ok) {
          var msg = 'Terjadi kesalahan pada server.';
          if (ct.indexOf('application/json') !== -1) {
            var j = await res.json(); msg = j.error || msg;
          } else {
            try { msg = (await res.text()).slice(0, 160) || msg; } catch (_) {}
          }
          toast('error', 'Gagal memproses', msg);
          return;
        }
        var blob = await res.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = fileNameFrom(res);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        var doneMsg = a.download + ' telah diunduh.';
        if (cfg.stats) {
          var o = parseInt(res.headers.get('x-original-size'), 10);
          var c = parseInt(res.headers.get('x-compressed-size'), 10);
          if (o > 0 && c > 0) {
            var pct = Math.max(0, Math.round((1 - c / o) * 100));
            doneMsg = fmtSize(o) + ' → ' + fmtSize(c) + ' · hemat ' + pct + '% · ' + a.download;
          }
        }
        toast('success', 'Berhasil', doneMsg);
        files = [];
      } catch (err) {
        toast('error', 'Koneksi gagal', 'Pastikan server berjalan lalu coba lagi.');
      } finally {
        setLoading(false);
      }
    }

    btnLabel.textContent = cfg.label;
    render();
  }

  panels.filter(function (panel) { return panel.hasAttribute('data-endpoint'); }).forEach(makeTool);

  /* ---------- Link to QR Code ---------- */
  function makeQrTool() {
    var form = document.getElementById('qrForm');
    if (!form) return;

    var input = document.getElementById('qrUrl');
    var size = document.getElementById('qrSize');
    var correction = document.getElementById('qrCorrection');
    var btn = document.getElementById('qrGenerate');
    var label = btn.querySelector('.btn-label');
    var progress = document.getElementById('qrProgress');
    var hint = document.getElementById('qrHint');
    var result = document.getElementById('qrResult');
    var image = document.getElementById('qrImage');
    var resultUrl = document.getElementById('qrResultUrl');
    var download = document.getElementById('qrDownload');
    var objectUrl = '';

    function normalizedForDisplay(value) {
      var url = value.trim();
      return url.indexOf('://') === -1 ? 'https://' + url : url;
    }

    function clearResult() {
      result.hidden = true;
      image.removeAttribute('src');
      download.removeAttribute('href');
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }
    }

    function setLoading(on) {
      btn.classList.toggle('loading', on);
      progress.classList.toggle('on', on);
      label.textContent = on ? 'Membuat QR code…' : 'Buat QR Code';
      input.disabled = on;
      size.disabled = on;
      correction.disabled = on;
      btn.disabled = on || !input.value.trim();
    }

    input.addEventListener('input', function () {
      clearResult();
      btn.disabled = !input.value.trim();
      hint.textContent = input.value.trim() ? '' : 'Masukkan link untuk mulai membuat QR code.';
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var rawUrl = input.value.trim();
      if (!rawUrl) {
        input.focus();
        return;
      }

      clearResult();
      setLoading(true);
      hint.textContent = '';

      try {
        var response = await fetch('/generate-qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: rawUrl,
            size: Number(size.value),
            error_correction: correction.value
          })
        });
        var contentType = response.headers.get('content-type') || '';
        if (!response.ok) {
          var message = 'QR code gagal dibuat.';
          if (contentType.indexOf('application/json') !== -1) {
            var payload = await response.json();
            message = payload.error || message;
          }
          hint.textContent = message;
          toast('error', 'Gagal membuat QR code', message);
          return;
        }

        var blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        image.src = objectUrl;
        download.href = objectUrl;
        resultUrl.textContent = normalizedForDisplay(rawUrl);
        result.hidden = false;
        toast('success', 'QR code berhasil dibuat', 'Pratinjau siap dipindai atau diunduh sebagai PNG.');
      } catch (_) {
        var message = 'Pastikan server berjalan lalu coba lagi.';
        hint.textContent = message;
        toast('error', 'Koneksi gagal', message);
      } finally {
        setLoading(false);
      }
    });

    window.addEventListener('beforeunload', function () {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
  }

  makeQrTool();



})();
