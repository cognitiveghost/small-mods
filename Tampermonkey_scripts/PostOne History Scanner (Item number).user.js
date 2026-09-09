// ==UserScript==
// @name         PostOne History Scanner (Item number)
// @namespace    dolphin.postone.history
// @version      1.2.0
// @description  Bulk-scan on PostOne /history: filters the "Item number" column by the raw barcode, extracts tracking, reference, partner, sender, status, dates, receiver, country and invoice weight, and exports to Excel (.xlsx) or CSV.
// @author       dolphin
// @match        https://postone.eu/history*
// @icon         https://postone.eu/favicon.ico
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * ────────────────────────────────────────────────────────────────────────
 *  CONFLICTS WITH OTHER SCRIPTS:
 *   This script logs as [PostOne scanner]. If the console also shows messages
 *   like [Postone Script vX] / [Postone] Form not loaded yet..., that is a
 *   SEPARATE script which also binds to /history and conflicts with this one.
 *   Disable it (and any older copy of this scanner) in Tampermonkey.
 *
 *  PAGE CONTRACT (confirmed against the live postone.eu/history form, 14.07.2026):
 *   - Table #shipments (server-side DataTables, ajax "/history/getShipments").
 *   - Columns are located by HEADING TEXT, so reordering them does not break it.
 *   - "Item number" search = the input in the filter row, in that SAME column
 *     (the element's own class is misleading).
 *   - The barcode is never edited, only trimmed. Cells are read via innerText.
 *   - Search trigger: primarily a click on #shipments-filter-table; Enter is
 *     the fallback.
 *   - Readiness is detected by change-detection polling (no jQuery, no draw.dt).
 *
 *  v1.1.3 fix: the internal result flag `status` collided with the shipment's
 *   own "Status" column value, so a found shipment could be counted as an
 *   error. The internal flag is now `_state`; the column stays `status`.
 * ────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // --- guard against a double install / duplicated UI ---
  if (window.__POS_SCANNER_LOADED__) {
    try { console.log('[PostOne scanner] already loaded (' + window.__POS_SCANNER_LOADED__ + ') - skipping duplicate'); } catch (e) {}
    return;
  }
  window.__POS_SCANNER_LOADED__ = '1.1.3';

  /* ===================== CONFIGURATION ===================== */
  const CFG = {
    table: '#shipments',
    filterBtn: '#shipments-filter-table',
    header_item: 'item number',
    columns: [
      { key: 'item',      needle: 'item number',      label: 'Item number' },
      { key: 'tracking',  needle: 'tracking number',  label: 'Tracking number' },
      { key: 'reference', needle: 'reference number', label: 'Reference number' },
      { key: 'partner',   needle: 'track partner',    label: 'Track Partner' },
      { key: 'sender',    needle: 'sender',           label: 'Sender' },
      { key: 'status',    needle: 'status',           label: 'Status' },
      { key: 'created',   needle: 'created at',       label: 'Created at' },
      { key: 'manifested',needle: 'manifested',       label: 'Manifested at' },
      { key: 'dispatched',needle: 'dispatched',       label: 'Dispatched at' },
      { key: 'receiver',  needle: 'receiver',         label: "Receiver's information" },
      { key: 'country',   needle: 'country',          label: 'Country' },
      { key: 'invweight', needle: 'invoice weight',   label: 'Invoice Weight' },
    ],
    searchTimeoutMs: 15000,
    pollMs: 150,
    settleMs: 300,
    log: true,
  };

  /* ===================== HELPERS ===================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const log = (...a) => { if (CFG.log) { try { console.log('[PostOne scanner]', ...a); } catch (e) {} } };
  const errText = (err) => {
    try {
      if (err == null) return 'no details';
      if (typeof err === 'string') return err || 'empty error';
      const parts = [];
      if (err.name) parts.push(err.name);
      if (err.message) parts.push(err.message);
      if (!parts.length && err.stack) parts.push(String(err.stack).split('\n')[0]);
      if (!parts.length) parts.push(Object.prototype.toString.call(err));
      return parts.join(': ');
    } catch (e) { return 'could not read the error'; }
  };

  function setNativeValue(el, value) {
    let ok = false;
    try {
      const proto = Object.getPrototypeOf(el) || window.HTMLInputElement.prototype;
      let desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (!desc || !desc.set) desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (desc && desc.set) { desc.set.call(el, value); ok = true; }
    } catch (e) { log('setNativeValue setter failed', errText(e)); }
    if (!ok) { try { el.value = value; } catch (e) { log('setNativeValue direct failed', errText(e)); } }
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  }

  function triggerSearch(el) {
    const btn = document.querySelector(CFG.filterBtn);
    if (btn) { try { btn.click(); } catch (e) { log('filterBtn click failed', errText(e)); } }
    try { el.focus(); } catch (e) {}
    ['keydown', 'keypress', 'keyup'].forEach((type) => {
      try {
        const ev = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' });
        try { Object.defineProperty(ev, 'keyCode', { get: () => 13 }); } catch (_) {}
        try { Object.defineProperty(ev, 'which', { get: () => 13 }); } catch (_) {}
        el.dispatchEvent(ev);
      } catch (e) { /* the button has already been clicked */ }
    });
  }

  function getTable() { return document.querySelector(CFG.table); }

  function detectColumns(table) {
    const heads = [...table.querySelectorAll('thead tr')[0].children].map((th) =>
      norm(th.textContent.replace(/[:*]/g, ''))
    );
    const findIdx = (needle) => {
      let i = heads.findIndex((h) => h === needle);
      if (i < 0) i = heads.findIndex((h) => h.startsWith(needle));
      if (i < 0) i = heads.findIndex((h) => h.includes(needle));
      return i;
    };
    const map = {};
    CFG.columns.forEach((c) => { map[c.key] = findIdx(c.needle); });
    map._itemIdx = findIdx(CFG.header_item);
    return map;
  }

  function getItemFilterInput(table, itemIdx) {
    const filterRow = table.querySelectorAll('thead tr')[1];
    if (!filterRow) return null;
    const cell = filterRow.children[itemIdx];
    return cell ? cell.querySelector('input') : null;
  }

  function cellText(td, key) {
    try {
      if (!td) return '';
      const lines = (td.innerText || td.textContent || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const sep = key === 'receiver' ? ', ' : ' ';
      return lines.join(sep);
    } catch (e) { return ''; }
  }

  function readInfo(table) {
    const el = document.getElementById((table.id || 'shipments') + '_info');
    return el ? (el.textContent || '').trim() : '';
  }

  function firstItemText(table, itemIdx) {
    const tr = table.querySelector('tbody tr');
    if (!tr || tr.querySelector('td.dataTables_empty')) return '__EMPTY__';
    return cellText(tr.children[itemIdx], 'item');
  }

  function bodyRows(table) {
    return [...table.querySelectorAll('tbody tr')].filter(
      (tr) => !tr.querySelector('td.dataTables_empty') && tr.children.length > 1
    );
  }

  async function searchItem(rawBarcode) {
    const table = getTable();
    if (!table) return { _state: 'error', msg: 'Table #shipments not found. Are you on the /history page?' };

    const cols = detectColumns(table);
    if (cols._itemIdx < 0) return { _state: 'error', msg: 'The "Item number" column was not found.' };

    const input = getItemFilterInput(table, cols._itemIdx);
    if (!input) return { _state: 'error', msg: 'The "Item number" filter field was not found.' };

    const beforeInfo = readInfo(table);
    const beforeItem = firstItemText(table, cols._itemIdx);

    setNativeValue(input, rawBarcode);
    triggerSearch(input);
    log('search', rawBarcode, { beforeInfo, beforeItem, itemIdx: cols._itemIdx });

    const start = Date.now();
    while (Date.now() - start < CFG.searchTimeoutMs) {
      await sleep(CFG.pollMs);

      const empty = !!table.querySelector('td.dataTables_empty');
      const info = readInfo(table);
      const fi = firstItemText(table, cols._itemIdx);
      const changed = info !== beforeInfo || fi !== beforeItem;

      if (empty) {
        if (changed || Date.now() - start > 1600) { log('notfound', rawBarcode); return { _state: 'notfound' }; }
        continue;
      }
      if (!changed) continue;

      await sleep(CFG.settleMs);
      const rows = bodyRows(table);
      if (!rows.length) { if (Date.now() - start > 1600) return { _state: 'notfound' }; continue; }

      const itemOf = (tr) => cellText(tr.children[cols._itemIdx], 'item');
      let chosen = rows.find((tr) => itemOf(tr) === rawBarcode);
      let exact = !!chosen;
      let multiple = 0;

      if (exact) {
        multiple = rows.filter((tr) => itemOf(tr) === rawBarcode).length;
      } else {
        const loose = rows.filter((tr) => { const v = itemOf(tr); return v && (v.includes(rawBarcode) || rawBarcode.includes(v)); });
        chosen = loose[0] || (rows.length === 1 ? rows[0] : null);
        multiple = loose.length;
        if (!chosen) { if (Date.now() - start > 4000) { chosen = rows[0]; } else continue; }
      }

      const rec = { _state: 'found', exact, multiple: multiple > 1 ? multiple : 0 };
      CFG.columns.forEach((c) => {
        try { rec[c.key] = cellText(chosen.children[cols[c.key]], c.key); }
        catch (e) { rec[c.key] = ''; log('cell extract failed', c.key, errText(e)); }
      });
      log('found', rawBarcode, rec);
      return rec;
    }
    log('timeout', rawBarcode);
    return { _state: 'timeout' };
  }

  /* ===================== STATE ===================== */
  const scans = [];
  let processing = false;
  const queue = [];

  /* ===================== UI ===================== */
  const CSS = `
    #pos-fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;background:#0b5cab;color:#fff;
      border:none;border-radius:28px;padding:12px 20px;font:600 14px/1.2 system-ui,Arial;cursor:pointer;
      box-shadow:0 4px 14px rgba(0,0,0,.3)}
    #pos-fab:hover{background:#094a8c}
    #pos-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483001;display:none;
      align-items:flex-start;justify-content:center}
    #pos-overlay.open{display:flex}
    #pos-modal{background:#fff;width:min(1500px,98vw);max-height:92vh;margin-top:3vh;border-radius:12px;
      display:flex;flex-direction:column;overflow:hidden;font:13px/1.4 system-ui,Arial;box-shadow:0 12px 40px rgba(0,0,0,.4)}
    #pos-head{background:#0b5cab;color:#fff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between}
    #pos-head h2{margin:0;font-size:17px}
    #pos-close{background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1}
    #pos-body{padding:16px 18px;overflow:auto}
    #pos-scanwrap{display:flex;gap:10px;margin-bottom:12px}
    #pos-scan{flex:1;padding:12px 14px;font-size:18px;border:2px solid #0b5cab;border-radius:8px;outline:none}
    #pos-scan:focus{box-shadow:0 0 0 3px rgba(11,92,171,.2)}
    #pos-go{background:#0b5cab;color:#fff;border:none;border-radius:8px;padding:0 18px;font:600 15px system-ui;cursor:pointer}
    #pos-go:hover{background:#094a8c}
    #pos-status{padding:8px 12px;border-radius:6px;margin-bottom:10px;font-weight:600;min-height:18px;display:none;white-space:pre-wrap}
    #pos-status.ok{background:#e6f7ea;color:#137333;display:block}
    #pos-status.err{background:#fce8e6;color:#c5221f;display:block}
    #pos-status.info{background:#e8f0fe;color:#1a56c4;display:block}
    #pos-counts{margin:6px 0 12px;font-weight:600;color:#333}
    table.pos-tbl{width:100%;border-collapse:collapse}
    table.pos-tbl th,table.pos-tbl td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:12px;vertical-align:top}
    table.pos-tbl th{background:#f4f4f4;position:sticky;top:0}
    tr.pos-bad td{background:#fff4f4}
    .pos-del{color:#c5221f;cursor:pointer;font-weight:700;border:none;background:none;font-size:15px}
    #pos-foot{padding:14px 18px;border-top:1px solid #eee;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
    .pos-btn{border:none;border-radius:8px;padding:10px 16px;font:600 14px system-ui;cursor:pointer}
    .pos-btn.primary{background:#137333;color:#fff}
    .pos-btn.primary:hover{background:#0f5c28}
    .pos-btn.ghost{background:#eee;color:#333}
    .pos-btn.ghost:hover{background:#ddd}
    .pos-badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700}
    .pos-badge.ok{background:#e6f7ea;color:#137333}
    .pos-badge.no{background:#fce8e6;color:#c5221f}
  `;

  function injectStyle() {
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function buildUI() {
    const fab = document.createElement('button');
    fab.id = 'pos-fab';
    fab.textContent = 'Item scanner';
    document.body.appendChild(fab);

    const ths = CFG.columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
    const overlay = document.createElement('div');
    overlay.id = 'pos-overlay';
    overlay.innerHTML = `
      <div id="pos-modal">
        <div id="pos-head">
          <h2>PostOne scanner - by Item number</h2>
          <button id="pos-close" title="Close">&times;</button>
        </div>
        <div id="pos-body">
          <div id="pos-scanwrap">
            <input id="pos-scan" placeholder="Scan a barcode here (raw, unedited)..." autocomplete="off" />
            <button id="pos-go" title="Search">Search</button>
          </div>
          <div id="pos-status"></div>
          <div id="pos-counts"></div>
          <table class="pos-tbl">
            <thead><tr>
              <th style="width:28px">#</th>
              ${ths}
              <th style="width:44px" title="Search result">Result</th>
              <th style="width:28px"></th>
            </tr></thead>
            <tbody id="pos-rows"></tbody>
          </table>
        </div>
        <div id="pos-foot">
          <button class="pos-btn ghost" id="pos-clear">Clear list</button>
          <button class="pos-btn ghost" id="pos-csv">Download CSV</button>
          <button class="pos-btn primary" id="pos-export">Download Excel (.xlsx)</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const scan = overlay.querySelector('#pos-scan');
    const statusEl = overlay.querySelector('#pos-status');

    const setStatus = (msg, kind) => {
      statusEl.className = kind || 'info';
      statusEl.textContent = msg;
      if (kind === 'ok' || kind === 'info') {
        clearTimeout(setStatus._t);
        setStatus._t = setTimeout(() => { statusEl.style.display = 'none'; statusEl.textContent = ''; }, 2500);
      }
    };

    const open = () => { overlay.classList.add('open'); setTimeout(() => scan.focus(), 50); };
    const close = () => overlay.classList.remove('open');

    fab.addEventListener('click', open);
    overlay.querySelector('#pos-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const submit = () => { const raw = scan.value; scan.value = ''; enqueueScan(raw, setStatus); };
    const onEnter = (e) => {
      if (e.key === 'Enter' || e.keyCode === 13 || e.which === 13) { e.preventDefault(); submit(); }
    };
    scan.addEventListener('keydown', onEnter);
    scan.addEventListener('keypress', onEnter);
    overlay.querySelector('#pos-go').addEventListener('click', submit);

    overlay.querySelector('#pos-clear').addEventListener('click', () => {
      if (scans.length && !confirm('Clear the whole list?')) return;
      scans.length = 0;
      renderRows();
      scan.focus();
    });
    overlay.querySelector('#pos-export').addEventListener('click', () => exportXlsx(setStatus));
    overlay.querySelector('#pos-csv').addEventListener('click', () => exportCsv(setStatus));

    return { overlay, scan, setStatus };
  }

  let ui;

  function enqueueScan(raw, setStatus) {
    const code = String(raw || '').replace(/[\r\n\t]/g, '').trim();
    if (!code) return;
    if (scans.some((s) => s.item === code && s._state === 'found')) {
      setStatus('Already scanned: ' + code, 'info');
      return;
    }
    queue.push({ code, setStatus });
    drainQueue();
  }

  async function drainQueue() {
    if (processing) return;
    processing = true;
    while (queue.length) {
      const { code, setStatus } = queue.shift();
      setStatus('Searching ' + code + '...', 'info');
      let res;
      try {
        res = await searchItem(code);
      } catch (err) {
        log('EXCEPTION in searchItem', err);
        res = { _state: 'error', msg: errText(err) };
      }

      if (res && res._state === 'found') {
        const rec = { _state: 'found', raw: code, time: new Date(), multiple: res.multiple, exact: res.exact };
        CFG.columns.forEach((c) => { rec[c.key] = res[c.key] || ''; });
        if (!rec.item) rec.item = code;
        scans.push(rec);
        const warn = res.multiple ? ` (warning: ${res.multiple} rows matched)`
                                  : (res.exact ? '' : ' (warning: no exact match)');
        setStatus(`Found ${rec.item} - ${rec.reference || '(no reference)'}${warn}`, 'ok');
      } else if (res && res._state === 'notfound') {
        scans.push(blankRec(code, 'notfound'));
        setStatus('Not found: ' + code, 'err');
      } else if (res && res._state === 'timeout') {
        scans.push(blankRec(code, 'timeout'));
        setStatus('Timed out: ' + code, 'err');
      } else {
        scans.push(blankRec(code, 'error'));
        setStatus('Error: ' + ((res && res.msg) || 'unknown') +
                  '\n(see the browser console: [PostOne scanner])', 'err');
      }
      renderRows();
    }
    processing = false;
    if (ui) ui.scan.focus();
  }

  function blankRec(code, state) {
    const rec = { _state: state, raw: code, time: new Date(), multiple: 0, exact: false };
    CFG.columns.forEach((c) => { rec[c.key] = ''; });
    rec.item = code;
    return rec;
  }

  function renderRows() {
    const tbody = document.querySelector('#pos-rows');
    if (!tbody) return;
    tbody.innerHTML = '';
    scans.forEach((s, idx) => {
      const tr = document.createElement('tr');
      if (s._state !== 'found') tr.className = 'pos-bad';
      const badge = s._state === 'found'
        ? '<span class="pos-badge ok">OK</span>'
        : `<span class="pos-badge no">${s._state === 'timeout' ? 'timeout'
             : (s._state === 'error' ? 'error' : 'none')}</span>`;
      const tds = CFG.columns.map((c) => `<td>${esc(s[c.key])}</td>`).join('');
      tr.innerHTML = `<td>${idx + 1}</td>${tds}<td>${badge}</td>` +
        `<td><button class="pos-del" title="Remove" data-i="${idx}">×</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.pos-del').forEach((b) =>
      b.addEventListener('click', (e) => { scans.splice(+e.target.dataset.i, 1); renderRows(); })
    );
    const found = scans.filter((s) => s._state === 'found').length;
    const bad = scans.length - found;
    const c = document.querySelector('#pos-counts');
    if (c) c.textContent = `Scans: ${scans.length}   Found: ${found}   Problems: ${bad}`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  /* ===================== EXPORT ===================== */
  function buildRows() {
    return scans.map((s, i) => {
      const row = { 'No.': i + 1 };
      CFG.columns.forEach((c) => { row[c.label] = s[c.key] || ''; });
      row['Result'] = s._state === 'found' ? 'found'
                    : (s._state === 'timeout' ? 'timeout'
                    : (s._state === 'error' ? 'error' : 'not found'));
      row['Raw scan'] = s.raw;
      row['Scanned at'] = s.time ? s.time.toLocaleString('en-GB') : '';
      return row;
    });
  }

  function exportXlsx(setStatus) {
    if (!scans.length) { setStatus('The list is empty.', 'err'); return; }
    if (typeof XLSX === 'undefined') {
      setStatus('XLSX library did not load (CSP?). Falling back to CSV...', 'err');
      exportCsv(setStatus);
      return;
    }
    const rows = buildRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0]).map((k) => ({ wch: Math.min(34, Math.max(10, k.length + 4)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PostOne');
    XLSX.writeFile(wb, `postone-history-${stamp()}.xlsx`);
    setStatus('Excel file generated.', 'ok');
  }

  function exportCsv(setStatus) {
    if (!scans.length) { setStatus('The list is empty.', 'err'); return; }
    const rows = buildRows();
    const headers = Object.keys(rows[0]);
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = '﻿' + [headers.map(q).join(',')]
      .concat(rows.map((r) => headers.map((h) => q(r[h])).join(',')))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `postone-history-${stamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus('CSV file generated.', 'ok');
  }

  function stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }

  /* ===================== BOOT ===================== */
  function init() {
    injectStyle();
    ui = buildUI();
    renderRows();
    try {
      window.addEventListener('error', (e) => log('window.error', e.message, e.filename + ':' + e.lineno));
      window.addEventListener('unhandledrejection', (e) => log('unhandledrejection', errText(e && e.reason)));
    } catch (e) {}
    log('ready v1.1.3');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();