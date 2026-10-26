/*
 * DOM integration checks against the Flask-rendered page and its served scripts.
 * Start Flask first, then:
 *   npm.cmd install --prefix tmp/js-test-runtime --no-save --no-package-lock jsdom
 *   node --test tests/test_split_ui.cjs
 * Override DOCFORGE_TEST_URL to use a different local server.
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { JSDOM, VirtualConsole } = require(path.resolve(__dirname, '../tmp/js-test-runtime/node_modules/jsdom'));

const baseUrl = process.env.DOCFORGE_TEST_URL || 'http://127.0.0.1:5000';
let markup;
let appScript;
let splitScript;

before(async () => {
  const resources = await Promise.all(['/', '/static/app.js', '/static/split.js'].map(async (resource) => {
    const response = await fetch(new URL(resource, baseUrl));
    assert.equal(response.status, 200, `Flask must serve ${resource}`);
    return response.text();
  }));
  [markup, appScript, splitScript] = resources;
  assert.match(markup, /id="splitForm"/, 'Use the actual rendered split form');
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function setup(t, fetchHandler) {
  const jsErrors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => jsErrors.push(error));
  const dom = new JSDOM(markup, {
    url: `${baseUrl}/#split`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console,
  });
  const { window } = dom;
  const created = [];
  const revoked = [];
  const requests = [];
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.URL.createObjectURL = (blob) => {
    const url = `blob:docforge-test/${created.length + 1}`;
    created.push({ blob, url });
    return url;
  };
  window.URL.revokeObjectURL = (url) => revoked.push(url);
  window.fetch = async (url, options) => {
    requests.push({ url, options });
    if (fetchHandler) return fetchHandler(url, options);
    assert.equal(url, '/split-pdf/inspect');
    return jsonResponse({ filename: options.body.get('file').name, page_count: 6 });
  };
  window.eval(appScript);
  window.eval(splitScript);
  const byId = (id) => window.document.getElementById(id);
  const fire = (element, type = 'input') => element.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  const value = (id, text) => { byId(id).value = text; fire(byId(id)); };
  const mode = (name) => {
    const radio = window.document.querySelector(`input[name="splitMode"][value="${name}"]`);
    radio.checked = true;
    fire(radio, 'change');
  };
  const chooseFile = (name = 'laporan.pdf', text = '%PDF-1.7 test fixture') => {
    const candidate = new window.File([text], name, { type: 'application/pdf' });
    Object.defineProperty(byId('splitFile'), 'files', { configurable: true, value: [candidate] });
    fire(byId('splitFile'), 'change');
    return candidate;
  };
  const inspect = async (name) => {
    chooseFile(name);
    await waitFor(() => !byId('splitSettings').disabled, 'inspection to activate settings');
  };
  const outputPages = () => Array.from(byId('splitPreviewList').querySelectorAll('small'), (item) => item.textContent);
  t.after(() => {
    dom.window.close();
    assert.deepEqual(jsErrors, [], 'Scripts must not raise browser DOM errors');
  });
  return { window, byId, fire, value, mode, chooseFile, inspect, outputPages, created, revoked, requests };
}

test('the #split link selects the split panel and tab navigation preserves accessible selection', (t) => {
  const ui = setup(t);
  assert.equal(ui.byId('panel-split').hidden, false);
  assert.equal(ui.byId('panel-md').hidden, true);
  assert.equal(ui.byId('tab-split').getAttribute('aria-selected'), 'true');
  assert.equal(ui.byId('tab-split').tabIndex, 0);
  assert.equal(ui.byId('splitSettings').disabled, true);
  assert.equal(ui.byId('splitSubmit').disabled, true);
  assert.equal(ui.byId('splitSource').hidden, true);
  assert.equal(ui.byId('splitDropzone').hidden, false);
  assert.equal(ui.byId('splitForm').getAttribute('aria-busy'), 'false');

  ui.byId('tab-split').dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(ui.byId('tab-compress').getAttribute('aria-selected'), 'true');
  assert.equal(ui.window.location.hash, '#compress');
  ui.byId('tab-split').click();
  assert.equal(ui.window.location.hash, '#split');
  assert.equal(ui.byId('panel-split').hidden, false);
});

test('inspection enables six default outputs and grouping preserves the final remainder', async (t) => {
  const ui = setup(t);
  ui.chooseFile();
  assert.equal(ui.byId('splitForm').getAttribute('aria-busy'), 'true');
  assert.equal(ui.byId('splitDropzone').hidden, true);
  await waitFor(() => !ui.byId('splitSettings').disabled, 'inspection completion');

  assert.match(ui.byId('splitFileMeta').textContent, /6 halaman/);
  assert.equal(ui.byId('splitEvery').max, '6');
  assert.match(ui.byId('splitOutputCount').textContent, /^6 file PDF/);
  assert.equal(ui.byId('splitPreviewList').children.length, 6);
  assert.deepEqual(ui.outputPages(), ['Halaman 1', 'Halaman 2', 'Halaman 3', 'Halaman 4', 'Halaman 5', 'Halaman 6']);
  assert.equal(ui.byId('splitSubmit').disabled, false);
  assert.equal(ui.window.document.activeElement.value, 'every');
  assert.equal(ui.requests[0].options.body.get('file').name, 'laporan.pdf');

  ui.value('splitEvery', '2');
  assert.match(ui.byId('splitOutputCount').textContent, /^3 file PDF/);
  assert.deepEqual(ui.outputPages(), ['Halaman 1-2', 'Halaman 3-4', 'Halaman 5-6']);
  ui.value('splitEvery', '4');
  assert.deepEqual(ui.outputPages(), ['Halaman 1-4', 'Halaman 5-6']);
});

test('range and selection modes validate input while preserving page order and output semantics', async (t) => {
  const ui = setup(t);
  await ui.inspect();
  ui.mode('ranges');
  assert.equal(ui.byId('splitRangesOptions').hidden, false);
  assert.equal(ui.byId('splitEveryOptions').hidden, true);
  ui.value('splitRanges', '1-2, 4, 6');
  assert.match(ui.byId('splitOutputCount').textContent, /^3 file PDF/);
  assert.deepEqual(ui.outputPages(), ['Halaman 1-2', 'Halaman 4', 'Halaman 6']);

  ui.value('splitRanges', '1--2');
  assert.equal(ui.byId('splitSubmit').disabled, true);
  assert.equal(ui.byId('splitRanges').getAttribute('aria-invalid'), 'true');
  assert.match(ui.byId('splitInputError').textContent, /nomor atau rentang/);
  ui.value('splitRanges', '1-3, 2-4');
  assert.equal(ui.byId('splitSubmit').disabled, false, 'Separate range outputs may overlap');
  assert.match(ui.byId('splitOutputCount').textContent, /^2 file PDF/);

  ui.mode('selected');
  assert.equal(ui.byId('splitSubmit').disabled, true, 'Duplicate pages are invalid within one selected PDF');
  assert.match(ui.byId('splitInputError').textContent, /lebih dari sekali/);
  ui.value('splitRanges', '6, 1-2, 4');
  assert.equal(ui.byId('splitSubmit').disabled, false);
  assert.match(ui.byId('splitOutputCount').textContent, /^1 file PDF/);
  assert.deepEqual(ui.outputPages(), ['Halaman 6, 1-2, 4']);
  ui.value('splitRanges', '1-7');
  assert.equal(ui.byId('splitSubmit').disabled, true);
  assert.match(ui.byId('splitInputError').textContent, /antara 1 dan 6/);
  ui.mode('every');
  ui.value('splitEvery', '7');
  assert.equal(ui.byId('splitSubmit').disabled, true);
  assert.equal(ui.byId('splitEvery').getAttribute('aria-invalid'), 'true');
});

test('successful processing exposes a downloadable Blob and edits revoke the previous result', async (t) => {
  const pending = deferred();
  const ui = setup(t, (url) => url === '/split-pdf/inspect'
    ? jsonResponse({ filename: 'laporan.pdf', page_count: 6 })
    : pending.promise);
  await ui.inspect();
  ui.mode('selected');
  ui.value('splitRanges', '2-3, 6');
  ui.fire(ui.byId('splitForm'), 'submit');
  assert.equal(ui.byId('splitSettings').disabled, true);
  assert.equal(ui.byId('splitRemove').disabled, true);
  assert.equal(ui.byId('splitForm').getAttribute('aria-busy'), 'true');
  const request = ui.requests.at(-1);
  assert.equal(request.url, '/split-pdf');
  assert.equal(request.options.body.get('mode'), 'selected');
  assert.equal(request.options.body.get('ranges'), '2-3, 6');
  assert.equal(request.options.body.get('file').name, 'laporan.pdf');

  pending.resolve(new Response(new Blob(['%PDF-1.7 result'], { type: 'application/pdf' }), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="laporan_halaman-pilihan.pdf"' },
  }));
  await waitFor(() => !ui.byId('splitResult').hidden, 'successful downloadable result');
  assert.equal(ui.byId('splitDownload').getAttribute('href'), 'blob:docforge-test/1');
  assert.equal(ui.byId('splitDownload').download, 'laporan_halaman-pilihan.pdf');
  assert.equal(ui.byId('splitDownload').textContent, 'Unduh PDF');
  assert.match(ui.byId('splitResultTitle').textContent, /1 file PDF berhasil/);
  assert.ok(ui.created[0].blob.size > 0);
  assert.equal(ui.byId('splitSettings').disabled, false);
  assert.equal(ui.byId('splitForm').getAttribute('aria-busy'), 'false');
  assert.equal(ui.window.document.activeElement.id, 'splitResult');

  ui.value('splitRanges', '1-2');
  assert.equal(ui.byId('splitResult').hidden, true);
  assert.equal(ui.byId('splitDownload').hasAttribute('href'), false);
  assert.deepEqual(ui.revoked, ['blob:docforge-test/1']);
  assert.equal(ui.byId('splitSubmit').disabled, false);

  ui.byId('splitRemove').click();
  assert.equal(ui.byId('splitSource').hidden, true);
  assert.equal(ui.byId('splitDropzone').hidden, false);
  assert.equal(ui.byId('splitSettings').disabled, true);
  assert.equal(ui.byId('splitPreview').hidden, true);
  assert.equal(ui.byId('splitSubmit').disabled, true);
  assert.equal(ui.byId('splitRanges').value, '');
  assert.equal(ui.byId('splitEvery').value, '1');
  assert.equal(ui.window.document.activeElement.id, 'splitDropzone');
});

test('server errors remain actionable and a corrected configuration clears the error', async (t) => {
  const ui = setup(t, (url) => url === '/split-pdf/inspect'
    ? jsonResponse({ filename: 'laporan.pdf', page_count: 6 })
    : jsonResponse({ error: 'Ukuran hasil melebihi 250 MB.' }, 400));
  await ui.inspect();
  ui.fire(ui.byId('splitForm'), 'submit');
  await waitFor(() => ui.byId('splitForm').getAttribute('aria-busy') === 'false', 'error response');
  assert.match(ui.byId('splitInputError').textContent, /250 MB/);
  assert.equal(ui.byId('splitResult').hidden, true);
  assert.equal(ui.byId('splitRemove').disabled, false);
  assert.equal(ui.byId('splitSubmit').disabled, false, 'User may retry after a server error');
  ui.value('splitEvery', '2');
  assert.equal(ui.byId('splitInputError').textContent, '');
});

test('reset aborts inspection and a stale response cannot overwrite a replacement PDF', async (t) => {
  const oldInspection = deferred();
  const newInspection = deferred();
  const ui = setup(t, (_url, options) => options.body.get('file').name === 'old.pdf'
    ? oldInspection.promise : newInspection.promise);
  ui.chooseFile('old.pdf');
  const firstRequest = ui.requests[0];
  ui.byId('splitRemove').click();
  assert.equal(firstRequest.options.signal.aborted, true);
  ui.chooseFile('replacement.pdf');
  newInspection.resolve(jsonResponse({ filename: 'replacement.pdf', page_count: 6 }));
  await waitFor(() => !ui.byId('splitSettings').disabled, 'replacement inspection');
  oldInspection.resolve(jsonResponse({ filename: 'old.pdf', page_count: 12 }));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ui.byId('splitFileName').textContent, 'replacement.pdf');
  assert.match(ui.byId('splitFileMeta').textContent, /^6 halaman/);
  assert.equal(ui.byId('splitEvery').max, '6');
  assert.match(ui.byId('splitOutputCount').textContent, /^6 file PDF/);
  assert.equal(ui.byId('splitForm').getAttribute('aria-busy'), 'false');
});

test('output and range limits prevent unsupported requests before submission', async (t) => {
  const ui = setup(t, () => jsonResponse({ filename: 'besar.pdf', page_count: 1000 }));
  ui.chooseFile('besar.pdf');
  await waitFor(() => !ui.byId('splitSettings').disabled, 'large PDF inspection');
  assert.equal(ui.byId('splitSubmit').disabled, true);
  assert.match(ui.byId('splitInputError').textContent, /Maksimum 500 file/);
  ui.value('splitEvery', '2');
  assert.equal(ui.byId('splitSubmit').disabled, false);
  assert.match(ui.byId('splitOutputCount').textContent, /^500 file PDF/);
  assert.match(ui.byId('splitPreviewList').lastElementChild.textContent, /494 file lainnya/);
  ui.mode('selected');
  ui.value('splitRanges', Array.from({ length: 501 }, (_, i) => String(i + 1)).join(', '));
  assert.equal(ui.byId('splitSubmit').disabled, true);
  assert.match(ui.byId('splitInputError').textContent, /Maksimum 500 rentang/);
});
