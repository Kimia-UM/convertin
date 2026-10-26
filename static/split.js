(function () {
  'use strict';

  var form = document.getElementById('splitForm');
  if (!form) return;
  var byId = function (id) { return document.getElementById(id); };
  var input = byId('splitFile');
  var dropzone = byId('splitDropzone');
  var source = byId('splitSource');
  var status = byId('splitInspectStatus');
  var settings = byId('splitSettings');
  var every = byId('splitEvery');
  var ranges = byId('splitRanges');
  var error = byId('splitInputError');
  var preview = byId('splitPreview');
  var previewList = byId('splitPreviewList');
  var submit = byId('splitSubmit');
  var buttonLabel = submit.querySelector('.btn-label');
  var progress = byId('splitProgress');
  var hint = byId('splitHint');
  var result = byId('splitResult');
  var download = byId('splitDownload');
  var remove = byId('splitRemove');
  var file = null;
  var pageCount = 0;
  var inspecting = false;
  var processing = false;
  var requestId = 0;
  var inspectController = null;
  var resultUrl = '';
  var groups = [];
  var MAX_SIZE = 100 * 1024 * 1024;
  var MAX_OUTPUTS = 500;

  function mode() {
    return form.querySelector('input[name="splitMode"]:checked').value;
  }

  function sizeLabel(bytes) {
    return bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
  }

  function clearResult() {
    result.hidden = true;
    download.removeAttribute('href');
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = '';
  }

  function setError(message) {
    error.textContent = message || '';
    error.hidden = !message;
    every.setAttribute('aria-invalid', message && mode() === 'every' ? 'true' : 'false');
    ranges.setAttribute('aria-invalid', message && mode() !== 'every' ? 'true' : 'false');
  }

  function parseRanges(value) {
    if (!value.trim()) throw new Error('Masukkan halaman atau rentang, misalnya 1-3, 5, 7-9.');
    if (value.length > 10000) throw new Error('Daftar halaman terlalu panjang. Gunakan rentang untuk meringkas.');
    var parts = value.split(',');
    if (parts.length > MAX_OUTPUTS) throw new Error('Maksimum 500 rentang halaman dalam satu proses.');
    var seen = new Set();
    var copiedPages = 0;
    return parts.map(function (part) {
      var match = /^\s*([0-9]{1,6})\s*(?:-\s*([0-9]{1,6}))?\s*$/.exec(part);
      if (!match) throw new Error('Gunakan nomor atau rentang dengan tanda minus, dipisahkan koma. Contoh: 1-3, 5.');
      var first = Number(match[1]);
      var last = match[2] === undefined ? first : Number(match[2]);
      if (first < 1 || last > pageCount || first > pageCount || last < 1) {
        throw new Error('Nomor halaman harus antara 1 dan ' + pageCount + '.');
      }
      if (first > last) throw new Error('Awal rentang harus lebih kecil atau sama dengan akhir rentang.');
      var pages = [];
      for (var page = first; page <= last; page++) {
        if (mode() === 'selected' && seen.has(page)) throw new Error('Halaman ' + page + ' ditulis lebih dari sekali. Periksa rentang yang bertumpuk.');
        seen.add(page);
        pages.push(page);
      }
      copiedPages += pages.length;
      if (copiedPages > 5000) throw new Error('Jumlah halaman hasil terlalu besar. Kurangi rentang yang bertumpuk.');
      return pages;
    });
  }

  function plan() {
    var selectedMode = mode();
    var outputs;
    if (selectedMode === 'every') {
      if (!/^[0-9]{1,6}$/.test(every.value) || Number(every.value) < 1 || Number(every.value) > pageCount) {
        throw new Error('Isi jumlah halaman per file antara 1 dan ' + pageCount + '.');
      }
      var step = Number(every.value);
      outputs = [];
      for (var start = 1; start <= pageCount; start += step) {
        var pages = [];
        for (var page = start; page <= Math.min(start + step - 1, pageCount); page++) pages.push(page);
        outputs.push(pages);
      }
    } else {
      outputs = parseRanges(ranges.value);
      if (selectedMode === 'selected') outputs = [outputs.flat()];
    }
    if (outputs.length > MAX_OUTPUTS) {
      throw new Error('Maksimum 500 file hasil. Perbesar jumlah halaman per file atau pilih rentang yang lebih sedikit.');
    }
    return outputs;
  }

  function compactPages(pages) {
    var segments = [];
    for (var i = 0; i < pages.length; i++) {
      var start = pages[i];
      var end = start;
      while (i + 1 < pages.length && pages[i + 1] === end + 1) end = pages[++i];
      segments.push(start === end ? String(start) : start + '-' + end);
    }
    return segments.join(', ');
  }

  function renderPreview() {
    previewList.replaceChildren();
    byId('splitOutputCount').textContent = groups.length + ' file PDF' + (groups.length > 1 ? ' dalam satu ZIP' : ' siap dibuat');
    groups.slice(0, 6).forEach(function (pages, index) {
      var row = document.createElement('li');
      var icon = document.createElement('span');
      icon.className = 'split-output-icon';
      icon.textContent = 'PDF';
      var meta = document.createElement('div');
      var name = document.createElement('strong');
      name.textContent = mode() === 'selected' ? 'PDF halaman pilihan' : 'PDF bagian ' + String(index + 1).padStart(2, '0');
      var details = document.createElement('small');
      details.textContent = 'Halaman ' + compactPages(pages);
      var count = document.createElement('span');
      count.className = 'split-output-pages';
      count.textContent = pages.length + ' hal.';
      meta.append(name, details);
      row.append(icon, meta, count);
      previewList.appendChild(row);
    });
    if (groups.length > 6) {
      var more = document.createElement('li');
      more.className = 'split-preview-more';
      more.textContent = '+ ' + (groups.length - 6) + ' file lainnya akan ikut diunduh.';
      previewList.appendChild(more);
    }
    preview.hidden = false;
  }

  function update() {
    var selectedMode = mode();
    byId('splitEveryOptions').hidden = selectedMode !== 'every';
    byId('splitRangesOptions').hidden = selectedMode === 'every';
    byId('splitRangesHelp').textContent = selectedMode === 'selected'
      ? 'Contoh: 1-3, 5, 7-9 menjadi satu PDF, sesuai urutan yang Anda tulis. Nomor dimulai dari 1.'
      : 'Contoh: 1-3, 5, 7-9 menjadi 3 PDF terpisah. Setiap bagian yang dipisahkan koma menjadi satu file.';
    byId('splitEveryHelp').textContent = every.value === '1'
      ? 'Setiap halaman menjadi satu PDF terpisah.'
      : 'Setiap ' + (every.value || '…') + ' halaman menjadi satu PDF. Sisa halaman masuk ke file terakhir.';
    settings.disabled = !pageCount || inspecting || processing;
    input.disabled = processing;
    remove.disabled = processing;
    byId('splitReset').disabled = processing;
    form.setAttribute('aria-busy', inspecting || processing ? 'true' : 'false');
    submit.classList.toggle('loading', processing);
    progress.classList.toggle('on', processing || inspecting);
    submit.disabled = true;
    preview.hidden = true;
    groups = [];
    setError('');
    buttonLabel.textContent = processing ? 'Memisahkan PDF…' : 'Pisahkan PDF';
    if (!pageCount || inspecting) return;
    try {
      groups = plan();
      renderPreview();
      submit.disabled = processing;
      if (!processing) buttonLabel.textContent = mode() === 'selected' ? 'Buat PDF pilihan' : 'Pisahkan menjadi ' + groups.length + ' PDF';
      hint.textContent = groups.length > 1 ? 'Hasil dikemas dalam ZIP agar mudah diunduh sekaligus.' : 'Hasil berupa satu file PDF yang siap diunduh.';
    } catch (err) {
      setError(err.message);
      hint.textContent = 'Periksa pengaturan halaman untuk melanjutkan.';
    }
  }

  function reset(focus) {
    requestId++;
    if (inspectController) inspectController.abort();
    inspectController = null;
    file = null;
    pageCount = 0;
    inspecting = false;
    input.value = '';
    source.hidden = true;
    dropzone.hidden = false;
    status.textContent = '';
    status.classList.remove('is-error');
    every.value = '1';
    ranges.value = '';
    form.querySelector('input[name="splitMode"][value="every"]').checked = true;
    clearResult();
    update();
    hint.textContent = 'Pilih PDF untuk mulai mengatur halaman.';
    if (focus) dropzone.focus();
  }

  async function responseError(response, fallback) {
    if (response.status === 413) return 'Ukuran file terlalu besar. Maksimum 100 MB.';
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      var payload = await response.json();
      return payload.error || fallback;
    }
    return fallback;
  }

  async function inspectFile(files) {
    if (processing || !files || !files.length) return;
    if (files.length !== 1) {
      status.classList.add('is-error');
      status.textContent = 'Pilih satu PDF saja untuk dipisahkan.';
      return;
    }
    var candidate = files[0];
    reset(false);
    if (!/\.pdf$/i.test(candidate.name) || !candidate.size || candidate.size > MAX_SIZE) {
      status.classList.add('is-error');
      status.textContent = !/\.pdf$/i.test(candidate.name) ? 'Format belum sesuai. Pilih file PDF (.pdf).'
        : !candidate.size ? 'File kosong. Pilih PDF yang berisi halaman.' : 'Ukuran file maksimum 100 MB.';
      return;
    }
    file = candidate;
    inspecting = true;
    var currentId = requestId;
    inspectController = new AbortController();
    byId('splitFileName').textContent = file.name;
    byId('splitFileName').title = file.name;
    byId('splitFileMeta').textContent = sizeLabel(file.size) + ' · Membaca jumlah halaman…';
    source.hidden = false;
    dropzone.hidden = true;
    status.textContent = 'Memeriksa PDF…';
    update();
    var body = new FormData();
    body.append('file', file, file.name);
    try {
      var response = await fetch('/split-pdf/inspect', { method: 'POST', body: body, signal: inspectController.signal });
      if (!response.ok) throw new Error(await responseError(response, 'PDF gagal dibaca. Coba file PDF lain.'));
      var metadata = await response.json();
      if (currentId !== requestId) return;
      if (!Number.isInteger(metadata.page_count) || metadata.page_count < 1) throw new Error('Jumlah halaman PDF tidak dapat dibaca.');
      pageCount = metadata.page_count;
      every.max = String(pageCount);
      byId('splitFileMeta').textContent = pageCount + ' halaman · ' + sizeLabel(file.size);
      status.textContent = 'PDF siap. Pilih cara memisahkan di bawah.';
    } catch (err) {
      if (currentId !== requestId || err.name === 'AbortError') return;
      pageCount = 0;
      byId('splitFileMeta').textContent = sizeLabel(candidate.size) + ' · Tidak dapat diproses';
      status.classList.add('is-error');
      status.textContent = err instanceof TypeError ? 'Koneksi terputus. Pastikan server berjalan, lalu pilih ulang file.' : err.message;
      hint.textContent = 'Pilih Ganti file untuk mencoba lagi.';
    } finally {
      if (currentId === requestId) {
        inspecting = false;
        inspectController = null;
        update();
        if (pageCount && !byId('panel-split').hidden && (document.activeElement === document.body || form.contains(document.activeElement))) {
          form.querySelector('input[name="splitMode"]:checked').focus({ preventScroll: true });
        }
      }
    }
  }

  input.addEventListener('change', function () { inspectFile(input.files); });
  dropzone.addEventListener('keydown', function (event) {
    if (event.target === dropzone && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      input.click();
    }
  });
  ['dragenter', 'dragover'].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      if (name === 'dragleave' && dropzone.contains(event.relatedTarget)) return;
      dropzone.classList.remove('drag');
      if (name === 'drop') inspectFile(event.dataTransfer.files);
    });
  });
  remove.addEventListener('click', function () { if (!processing) reset(true); });
  byId('splitReset').addEventListener('click', function () { if (!processing) reset(true); });
  settings.addEventListener('input', function () { clearResult(); update(); });
  settings.addEventListener('change', function () { clearResult(); update(); });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (processing || inspecting || !file || !pageCount) return;
    update();
    if (!groups.length) {
      (mode() === 'every' ? every : ranges).focus();
      return;
    }
    var outputCount = groups.length;
    var body = new FormData();
    body.append('file', file, file.name);
    body.append('mode', mode());
    body.append(mode() === 'every' ? 'every' : 'ranges', mode() === 'every' ? every.value : ranges.value);
    clearResult();
    processing = true;
    update();
    hint.textContent = 'Sedang menyiapkan ' + outputCount + ' file PDF. Tunggu sebentar…';
    try {
      var response = await fetch('/split-pdf', { method: 'POST', body: body });
      if (!response.ok) throw new Error(await responseError(response, 'PDF gagal dipisahkan. Coba lagi.'));
      var blob = await response.blob();
      var disposition = response.headers.get('content-disposition') || '';
      var match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) || /filename="?([^";]+)"?/i.exec(disposition);
      var filename = outputCount > 1 ? 'pisah-pdf.zip' : 'halaman-pilihan.pdf';
      if (match) {
        try { filename = decodeURIComponent(match[1]); } catch (_) { /* Use the readable fallback. */ }
      }
      resultUrl = URL.createObjectURL(blob);
      download.href = resultUrl;
      download.download = filename;
      download.textContent = outputCount > 1 ? 'Unduh ZIP' : 'Unduh PDF';
      byId('splitResultTitle').textContent = outputCount + ' file PDF berhasil dibuat';
      byId('splitResultMeta').textContent = filename + ' · ' + sizeLabel(blob.size);
      result.hidden = false;
      result.setAttribute('tabindex', '-1');
      result.focus({ preventScroll: true });
      result.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    } catch (err) {
      setError(err instanceof TypeError ? 'Koneksi terputus. Pastikan server berjalan, lalu coba lagi.' : err.message);
    } finally {
      var serverError = error.textContent;
      processing = false;
      update();
      if (serverError) setError(serverError);
      if (!result.hidden) hint.textContent = 'Selesai. Unduh hasilnya atau ubah pengaturan untuk membuat versi lain.';
    }
  });

  window.addEventListener('beforeunload', function () {
    if (inspectController) inspectController.abort();
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  });
  reset(false);
})();
