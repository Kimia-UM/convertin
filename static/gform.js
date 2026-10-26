(function () {
  'use strict';

  var state = { file: null, inspection: null, preview: null };
  var FIELD_ORDER = [
    'row_type', 'title', 'description', 'options', 'required', 'section',
    'section_description', 'order', 'scale_min', 'scale_max',
    'scale_min_label', 'scale_max_label', 'grid_rows', 'grid_columns'
  ];
  var FIELD_LABELS = {
    row_type: 'Tipe pertanyaan',
    title: 'Judul/pertanyaan',
    description: 'Deskripsi/bantuan',
    options: 'Pilihan jawaban',
    required: 'Wajib diisi',
    section: 'Nama bagian',
    section_description: 'Deskripsi bagian',
    order: 'Urutan',
    scale_min: 'Skala minimum',
    scale_max: 'Skala maksimum',
    scale_min_label: 'Label minimum',
    scale_max_label: 'Label maksimum',
    grid_rows: 'Baris grid',
    grid_columns: 'Kolom grid'
  };
  var ALIASES = {
    order: ['order', 'urutan', 'nomorurut', 'no', 'nomor', 'sequence', 'index'],
    row_type: ['rowtype', 'type', 'tipe', 'jenis', 'questiontype', 'tipepertanyaan', 'jenissoal', 'itemtype'],
    title: ['question', 'pertanyaan', 'soal', 'title', 'judul', 'titleorquestion', 'pernyataan', 'item', 'questiontext', 'tekspertanyaan'],
    description: ['description', 'deskripsi', 'helptext', 'bantuan', 'petunjuk', 'keterangan', 'subtitle', 'questiondescription'],
    options: ['options', 'option', 'choices', 'choice', 'pilihan', 'opsi', 'jawaban', 'answeroptions', 'choicevalues'],
    required: ['required', 'wajib', 'mandatory', 'harusdiisi', 'isrequired'],
    section: ['section', 'sectiontitle', 'bagian', 'bagianjudul', 'pagetitle', 'halaman', 'kategori', 'group', 'kelompok'],
    section_description: ['sectiondescription', 'pagedescription', 'deskripsibagian', 'deskripsihalaman', 'sectionhelp', 'pagehelp'],
    scale_min: ['scalemin', 'min', 'minimum', 'nilaimin', 'batasbawah'],
    scale_max: ['scalemax', 'max', 'maximum', 'nilaimax', 'batasatas'],
    scale_min_label: ['scaleminlabel', 'minlabel', 'labelmin', 'labelbawah'],
    scale_max_label: ['scalemaxlabel', 'maxlabel', 'labelmax', 'labelatas'],
    grid_rows: ['rows', 'gridrows', 'barisgrid', 'baris', 'statements'],
    grid_columns: ['columns', 'gridcolumns', 'kolomgrid', 'kolom', 'ratings']
  };
  var TYPE_LABELS = {
    section: 'Bagian', header: 'Header', short_text: 'Jawaban singkat',
    paragraph: 'Paragraf', multiple_choice: 'Pilihan ganda',
    checkbox: 'Checkbox', dropdown: 'Dropdown', linear_scale: 'Skala linear',
    date: 'Tanggal', time: 'Waktu', grid: 'Grid', checkbox_grid: 'Checkbox grid'
  };

  var root = document.documentElement;
  var stored = localStorage.getItem('docforge-theme');
  var initial = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', initial);
  document.getElementById('themeToggle').addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('docforge-theme', next);
  });
  document.getElementById('year').textContent = new Date().getFullYear();

  var toasts = document.getElementById('toasts');
  function esc(value) {
    var node = document.createElement('div');
    node.textContent = value == null ? '' : String(value);
    return node.innerHTML;
  }
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
  function toast(type, title, message) {
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = '<span class="ti">' + (type === 'success' ? '✓' : type === 'error' ? '×' : 'i') + '</span>' +
      '<div class="tx"><div class="tt">' + esc(title) + '</div><div class="tm">' + esc(message || '') + '</div></div>' +
      '<button class="tc" aria-label="Tutup">×</button>';
    function dismiss() {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 250);
    }
    el.querySelector('.tc').addEventListener('click', dismiss);
    toasts.appendChild(el);
    setTimeout(dismiss, 5500);
  }
  function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
  }
  function setStep(step) {
    document.querySelectorAll('[data-step-indicator]').forEach(function (item) {
      var value = parseInt(item.dataset.stepIndicator, 10);
      item.classList.toggle('active', value === step);
      item.classList.toggle('done', value < step);
    });
  }
  function setLoading(button, loading, idleLabel, loadingLabel) {
    button.classList.toggle('loading', loading);
    button.disabled = loading;
    button.querySelector('.btn-label').textContent = loading ? loadingLabel : idleLabel;
  }

  var fileInput = document.getElementById('gformFile');
  var dropzone = document.getElementById('gformDropzone');
  var fileSummary = document.getElementById('fileSummary');
  var uploadStatus = document.getElementById('uploadStatus');
  var inspectButton = document.getElementById('inspectButton');
  var mappingCard = document.getElementById('mappingCard');
  var sheetSelect = document.getElementById('sheetSelect');
  var headerRow = document.getElementById('headerRow');
  var mappingGrid = document.getElementById('mappingGrid');
  var dataGlimpse = document.getElementById('dataGlimpse');
  var autoMapButton = document.getElementById('autoMapButton');
  var previewButton = document.getElementById('previewButton');
  var previewCard = document.getElementById('previewCard');
  var previewSummary = document.getElementById('previewSummary');
  var previewList = document.getElementById('previewList');
  var previewNote = document.getElementById('previewNote');
  var warningBox = document.getElementById('warningBox');
  var downloadButton = document.getElementById('downloadButton');

  function resetAfterFile() {
    state.inspection = null;
    state.preview = null;
    mappingCard.hidden = true;
    previewCard.hidden = true;
    setStep(1);
  }
  function chooseFile(file) {
    if (!file) return;
    var extension = (file.name.split('.').pop() || '').toLowerCase();
    if (['xlsx', 'xlsm', 'csv', 'tsv', 'txt'].indexOf(extension) === -1) {
      toast('error', 'Format tidak didukung', 'Gunakan XLSX, XLSM, CSV, TSV, atau TXT tabular.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast('error', 'File terlalu besar', 'Ukuran maksimum adalah 25 MB.');
      return;
    }
    state.file = file;
    resetAfterFile();
    fileSummary.hidden = false;
    fileSummary.innerHTML = '<span class="ftype sheet">' + esc(extension.toUpperCase().slice(0, 4)) + '</span>' +
      '<div><b>' + esc(file.name) + '</b><small>' + formatSize(file.size) + '</small></div>' +
      '<button type="button" id="removeGformFile" aria-label="Hapus file">×</button>';
    uploadStatus.textContent = 'File dipilih';
    uploadStatus.className = 'status-chip success';
    inspectButton.disabled = false;
    document.getElementById('removeGformFile').addEventListener('click', function () {
      state.file = null;
      fileInput.value = '';
      fileSummary.hidden = true;
      fileSummary.innerHTML = '';
      uploadStatus.textContent = 'Menunggu file';
      uploadStatus.className = 'status-chip';
      inspectButton.disabled = true;
      resetAfterFile();
    });
  }

  fileInput.addEventListener('change', function () { chooseFile(fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropzone.classList.remove('drag');
    });
  });
  dropzone.addEventListener('drop', function (event) {
    if (event.dataTransfer && event.dataTransfer.files.length) chooseFile(event.dataTransfer.files[0]);
  });
  dropzone.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });

  function currentSheet() {
    if (!state.inspection) return null;
    var index = parseInt(sheetSelect.value, 10);
    return state.inspection.sheets.find(function (sheet) { return sheet.index === index; }) || null;
  }
  function columnsForHeader(sheet) {
    var rowIndex = Math.max(0, parseInt(headerRow.value, 10) - 1);
    var header = sheet.head_rows[rowIndex] || [];
    var following = sheet.head_rows.slice(rowIndex + 1, rowIndex + 10);
    var width = following.reduce(function (max, row) { return Math.max(max, row.length); }, header.length || 1);
    var seen = {};
    return Array.from({ length: width }, function (_, index) {
      var raw = String(header[index] || '').trim();
      var base = raw || ('Kolom ' + (index + 1));
      seen[base] = (seen[base] || 0) + 1;
      var label = seen[base] > 1 ? base + ' (' + seen[base] + ')' : base;
      return { index: index, label: label, raw: raw };
    });
  }
  function guessMapping(columns) {
    var result = {};
    FIELD_ORDER.forEach(function (field) {
      var found = columns.find(function (column) {
        return (ALIASES[field] || []).indexOf(normalize(column.raw)) !== -1;
      });
      result[field] = found ? found.index : null;
    });
    return result;
  }
  function renderMapping(columns, values) {
    mappingGrid.innerHTML = FIELD_ORDER.map(function (field) {
      var options = '<option value="">— Tidak dipakai —</option>' + columns.map(function (column) {
        var selected = values[field] === column.index ? ' selected' : '';
        return '<option value="' + column.index + '"' + selected + '>' + esc(column.label) + '</option>';
      }).join('');
      var required = field === 'title' ? '<em>Wajib</em>' : '';
      return '<label class="field mapping-field"><span>' + esc(FIELD_LABELS[field]) + required + '</span>' +
        '<select data-map-field="' + field + '">' + options + '</select></label>';
    }).join('');
  }
  function renderGlimpse(sheet, columns) {
    var rowIndex = Math.max(0, parseInt(headerRow.value, 10) - 1);
    var rows = sheet.head_rows.slice(rowIndex, rowIndex + 5);
    var shownColumns = columns.slice(0, 8);
    var html = '<div class="glimpse-scroll"><table><thead><tr>' + shownColumns.map(function (column) {
      return '<th>' + esc(column.label) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.slice(1).map(function (row) {
      return '<tr>' + shownColumns.map(function (column) {
        var value = String(row[column.index] || '');
        return '<td title="' + esc(value) + '">' + esc(value || '—') + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
    if (columns.length > shownColumns.length) html += '<p>Menampilkan 8 dari ' + columns.length + ' kolom.</p>';
    dataGlimpse.innerHTML = html;
  }
  function applySheet(useDetectedMapping) {
    var sheet = currentSheet();
    if (!sheet) return;
    if (useDetectedMapping) headerRow.value = sheet.header_row;
    headerRow.max = Math.max(1, Math.min(30, sheet.head_rows.length));
    var columns = columnsForHeader(sheet);
    var values = useDetectedMapping && parseInt(headerRow.value, 10) === sheet.header_row
      ? sheet.mapping : guessMapping(columns);
    renderMapping(columns, values);
    renderGlimpse(sheet, columns);
    state.preview = null;
    previewCard.hidden = true;
    setStep(2);
  }

  inspectButton.addEventListener('click', async function () {
    if (!state.file) return;
    setLoading(inspectButton, true, 'Deteksi struktur file', 'Menganalisis…');
    var form = new FormData();
    form.append('file', state.file, state.file.name);
    try {
      var response = await fetch('/gform/inspect', { method: 'POST', body: form });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'File gagal dianalisis.');
      state.inspection = result;
      sheetSelect.innerHTML = result.sheets.map(function (sheet) {
        return '<option value="' + sheet.index + '">' + esc(sheet.name) + ' · ' + sheet.row_count + ' baris</option>';
      }).join('');
      sheetSelect.value = String(result.selected_sheet);
      document.getElementById('formTitle').value = result.detected_title || '';
      document.getElementById('formDescription').value = result.detected_description || '';
      mappingCard.hidden = false;
      applySheet(true);
      mappingCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('success', 'Struktur terdeteksi', result.sheets.length + ' sheet ditemukan. Periksa pemetaan sebelum melanjutkan.');
    } catch (error) {
      toast('error', 'Analisis gagal', error.message);
    } finally {
      setLoading(inspectButton, false, 'Deteksi struktur file', 'Menganalisis…');
      inspectButton.disabled = !state.file;
    }
  });

  sheetSelect.addEventListener('change', function () { applySheet(true); });
  headerRow.addEventListener('change', function () { applySheet(false); });
  autoMapButton.addEventListener('click', function () { applySheet(false); });

  function getMapping() {
    var mapping = {};
    document.querySelectorAll('[data-map-field]').forEach(function (select) {
      mapping[select.dataset.mapField] = select.value === '' ? null : parseInt(select.value, 10);
    });
    return mapping;
  }
  function getFormOptions() {
    return {
      title: document.getElementById('formTitle').value.trim(),
      description: document.getElementById('formDescription').value.trim(),
      confirmation_message: document.getElementById('confirmationMessage').value.trim(),
      option_separator: document.getElementById('optionSeparator').value,
      default_required: document.getElementById('defaultRequired').checked,
      collect_email: document.getElementById('collectEmail').checked,
      progress_bar: document.getElementById('progressBar').checked,
      shuffle_questions: document.getElementById('shuffleQuestions').checked,
      create_response_sheet: document.getElementById('responseSheet').checked
    };
  }
  function buildRequest() {
    var mapping = getMapping();
    var formOptions = getFormOptions();
    if (mapping.title == null) throw new Error('Pilih kolom Judul/pertanyaan.');
    if (!formOptions.title) throw new Error('Judul Google Form belum diisi.');
    var form = new FormData();
    form.append('file', state.file, state.file.name);
    form.append('sheet_index', sheetSelect.value);
    form.append('header_row', headerRow.value);
    form.append('mapping', JSON.stringify(mapping));
    form.append('form_options', JSON.stringify(formOptions));
    return form;
  }
  function renderPreview(result) {
    var summary = result.summary;
    var counts = summary.counts || {};
    previewSummary.innerHTML = [
      ['Pertanyaan', summary.question_count],
      ['Bagian', counts.section || 0],
      ['Header', counts.header || 0],
      ['Total elemen', summary.item_count]
    ].map(function (entry) {
      return '<div><b>' + esc(entry[1]) + '</b><span>' + esc(entry[0]) + '</span></div>';
    }).join('');

    if (result.warnings && result.warnings.length) {
      warningBox.hidden = false;
      warningBox.innerHTML = '<b>' + result.warnings.length + ' peringatan</b><ul>' + result.warnings.slice(0, 12).map(function (warning) {
        return '<li>' + esc(warning) + '</li>';
      }).join('') + '</ul>';
    } else {
      warningBox.hidden = true;
      warningBox.innerHTML = '';
    }

    previewList.innerHTML = result.items.map(function (item, index) {
      var details = [];
      if (item.required) details.push('Wajib');
      if (item.choices) details.push(item.choices.length + ' pilihan');
      if (item.type === 'linear_scale') details.push(item.min + '–' + item.max);
      if (item.rows) details.push(item.rows.length + ' baris × ' + item.columns.length + ' kolom');
      var choices = item.choices ? '<div class="choice-preview">' + item.choices.map(function (choice) {
        return '<span>' + esc(choice) + '</span>';
      }).join('') + '</div>' : '';
      return '<article class="preview-item type-' + esc(item.type) + '">' +
        '<span class="preview-index">' + (index + 1) + '</span>' +
        '<div class="preview-body"><div class="preview-meta"><b>' + esc(TYPE_LABELS[item.type] || item.type) + '</b><small>' + esc(details.join(' · ')) + '</small></div>' +
        '<h3>' + esc(item.title) + '</h3>' +
        (item.description ? '<p>' + esc(item.description) + '</p>' : '') + choices + '</div></article>';
    }).join('');
    previewNote.textContent = result.truncated
      ? 'Pratinjau dibatasi 120 elemen. Semua elemen tetap dimasukkan ke generator.'
      : 'Semua elemen form ditampilkan dalam pratinjau.';
  }

  previewButton.addEventListener('click', async function () {
    var requestBody;
    try {
      requestBody = buildRequest();
    } catch (error) {
      toast('error', 'Pemetaan belum lengkap', error.message);
      return;
    }
    setLoading(previewButton, true, 'Buat pratinjau', 'Menyusun pratinjau…');
    try {
      var response = await fetch('/gform/preview', { method: 'POST', body: requestBody });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Pratinjau gagal dibuat.');
      state.preview = result;
      renderPreview(result);
      previewCard.hidden = false;
      setStep(3);
      previewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('success', 'Pratinjau siap', result.summary.question_count + ' pertanyaan berhasil dikenali.');
    } catch (error) {
      toast('error', 'Pratinjau gagal', error.message);
    } finally {
      setLoading(previewButton, false, 'Buat pratinjau', 'Menyusun pratinjau…');
    }
  });

  document.getElementById('backToMapping').addEventListener('click', function () {
    mappingCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStep(2);
  });

  function downloadName(response) {
    var header = response.headers.get('content-disposition') || '';
    var match = /filename\*=UTF-8''([^;]+)/i.exec(header) || /filename="?([^";]+)"?/i.exec(header);
    if (!match) return 'gform_generator.gs';
    try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
  }
  downloadButton.addEventListener('click', async function () {
    var requestBody;
    try {
      requestBody = buildRequest();
    } catch (error) {
      toast('error', 'Konfigurasi belum lengkap', error.message);
      return;
    }
    setLoading(downloadButton, true, 'Unduh generator .gs', 'Membuat generator…');
    try {
      var response = await fetch('/gform/generate', { method: 'POST', body: requestBody });
      if (!response.ok) {
        var contentType = response.headers.get('content-type') || '';
        var message = 'Generator gagal dibuat.';
        if (contentType.indexOf('application/json') !== -1) {
          var result = await response.json();
          message = result.error || message;
        }
        throw new Error(message);
      }
      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = downloadName(response);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setStep(4);
      toast('success', 'Generator diunduh', 'Buka file .gs dan ikuti petunjuk pada bagian bawah halaman.');
    } catch (error) {
      toast('error', 'Unduhan gagal', error.message);
    } finally {
      setLoading(downloadButton, false, 'Unduh generator .gs', 'Membuat generator…');
    }
  });
})();
