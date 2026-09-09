// ==UserScript==
// @name         Speedy Returns Scanner
// @namespace    dolphin.speedy.returns
// @version      1.2.0
// @description  Bulk-scan returned MySpeedy consignments: scan a barcode (e.g. RET63571367473), look it up by waybill number, extract the reference and sender, and export to Excel (.xlsx) or CSV.
// @author       dolphin
// @match        https://myspeedy.speedy.bg/reports/consignments*
// @icon         https://myspeedy.speedy.bg/favicon.ico
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * ────────────────────────────────────────────────────────────────────────
 *  PAGE CONTRACT (confirmed against the live form, 14.07.2026):
 *   - "Товарителница" field   -> #consignment-number  (.consignment-input)
 *   - "Търси" (search) button -> #btn-search
 *   - Results table           -> #DataTables_Table_0  (.consignment-results-table)
 *   - Columns are located by their HEADING TEXT, so reordering or hiding a
 *     column does not break the script. The needles in CFG below are the
 *     site's own Bulgarian headings and MUST stay in Bulgarian - they are
 *     selectors, not display text.
 *   - The activation-date filters (#period-from-activation /
 *     #period-to-activation) are switched off so the search is not limited by
 *     date, which matters for older returns.
 *   - A raw scan "RET63571367473" is reduced to its digits, "63571367473".
 * ────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // --- guard against a double install / duplicated UI ---
  if (window.__SRS_SCANNER_LOADED__) return;
  window.__SRS_SCANNER_LOADED__ = '1.1.0';

  /* ===================== CONFIGURATION ===================== */
  const CFG = {
    consignmentInput: '#consignment-number',
    searchButton: '#btn-search',
    resultsTable: '#DataTables_Table_0',
    dateFromActivation: '#period-from-activation',
    dateToActivation: '#period-to-activation',
    // Cleared when the panel opens, so stale filters cannot narrow the search
    clearFields: ['#consignment-number', '#reference', '#receiver-name', '#order-number', '#file-number'],
    // Column headings as they appear on the site, normalised (SELECTORS - do not translate)
    col_waybill: 'номер на тов',
    col_order: 'заявка',        // "Номер заявка" (substring match)
    col_date: 'дата',           // "Дата" (exact match)
    col_receiver: 'получател име',
    col_receiverAddr: 'получател адрес',
    col_sender: 'подател име',
    col_senderAddr: 'подател адрес',
    col_packages: 'пакети',
    col_status: 'статус',
    col_ref1: 'референция 1',
    searchTimeoutMs: 12000,
    pollMs: 150,
  };

  /* ===================== HELPERS ===================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  // "RET63571367473" -> "63571367473" (digits only)
  function cleanScan(raw) {
    return String(raw || '').replace(/\D+/g, '');
  }

  function setNativeValue(el, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('keyup', { bubbles: true }));
  }

  function getTable() {
    return document.querySelector(CFG.resultsTable);
  }

  // Locate column indexes by heading text
  function detectColumns(table) {
    const ths = [...table.querySelectorAll('thead th')].map((th) =>
      norm(th.textContent.replace(/activate.*/i, '').replace(/[:*]/g, ''))
    );
    const findIdx = (needle) => ths.findIndex((t) => t.startsWith(needle));
    return {
      iW: findIdx(CFG.col_waybill),
      iO: ths.findIndex((t) => t.includes(CFG.col_order)),
      iD: ths.findIndex((t) => t === CFG.col_date),
      iR: findIdx(CFG.col_receiver),
      iRA: findIdx(CFG.col_receiverAddr),
      iS: findIdx(CFG.col_sender),
      iSA: findIdx(CFG.col_senderAddr),
      iP: findIdx(CFG.col_packages),
      iSt: findIdx(CFG.col_status),
      i1: findIdx(CFG.col_ref1),
    };
  }

  // Turn the activation-date filters off so the search is not limited by date
  function disableDateFilters() {
    [CFG.dateFromActivation, CFG.dateToActivation].forEach((sel) => {
      const cb = document.querySelector(sel);
      if (cb && cb.checked) cb.click();
    });
  }

  function clearInterferingFields() {
    CFG.clearFields.forEach((sel) => {
      const el = document.querySelector(sel);
      if (el && el.value) setNativeValue(el, '');
    });
  }

  // Run a search for one waybill number and wait for the result
  async function searchWaybill(cleanNum) {
    const input = document.querySelector(CFG.consignmentInput);
    const btn = document.querySelector(CFG.searchButton);
    if (!input || !btn) return { status: 'error', msg: 'Search form not found. Make sure you are on the consignments report page.' };

    setNativeValue(input, cleanNum);
    btn.click();

    const start = Date.now();
    while (Date.now() - start < CFG.searchTimeoutMs) {
      await sleep(CFG.pollMs);
      const table = getTable();
      if (!table) continue;

      // Empty result (DataTables marker)
      if (table.querySelector('td.dataTables_empty')) {
        return { status: 'notfound' };
      }

      const { iW, iO, iD, iR, iRA, iS, iSA, iP, iSt, i1 } = detectColumns(table);
      if (iW < 0) continue;

      const rows = [...table.querySelectorAll('tbody tr')].filter(
        (tr) => !tr.querySelector('td.dataTables_empty') && tr.children.length > 1
      );
      const cell = (tr, i) => (i >= 0 ? (tr.children[i]?.textContent || '').trim() : '');
      const matches = rows.filter((tr) => (tr.children[iW]?.textContent || '').trim() === cleanNum);
      if (matches.length) {
        const tr = matches[0];
        return {
          status: 'found',
          waybill: cell(tr, iW),
          order: cell(tr, iO),
          date: cell(tr, iD),
          receiver: cell(tr, iR),
          receiverAddr: cell(tr, iRA),
          sender: cell(tr, iS),
          senderAddr: cell(tr, iSA),
          packages: cell(tr, iP),
          statusText: cell(tr, iSt),
          ref1: cell(tr, i1),
          multiple: matches.length > 1 ? matches.length : 0,
        };
      }
      // Otherwise the table is still refreshing with the previous result; keep waiting
    }
    return { status: 'timeout' };
  }

  /* ===================== STATE ===================== */
  const scans = []; // {waybill, ref1, sender, status, raw, time, multiple}
  let processing = false;
  const queue = [];

  /* ===================== UI ===================== */
  const CSS = `
    #srs-fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;background:#c8102e;color:#fff;
      border:none;border-radius:28px;padding:12px 20px;font:600 14px/1.2 system-ui,Arial;cursor:pointer;
      box-shadow:0 4px 14px rgba(0,0,0,.3)}
    #srs-fab:hover{background:#a50d26}
    #srs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483001;display:none;
      align-items:flex-start;justify-content:center}
    #srs-overlay.open{display:flex}
    #srs-modal{background:#fff;width:min(1080px,96vw);max-height:92vh;margin-top:3vh;border-radius:12px;
      display:flex;flex-direction:column;overflow:hidden;font:14px/1.4 system-ui,Arial;box-shadow:0 12px 40px rgba(0,0,0,.4)}
    #srs-head{background:#c8102e;color:#fff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between}
    #srs-head h2{margin:0;font-size:17px}
    #srs-close{background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1}
    #srs-body{padding:16px 18px;overflow:auto}
    #srs-scanwrap{display:flex;gap:10px;margin-bottom:12px}
    #srs-scan{flex:1;padding:12px 14px;font-size:18px;border:2px solid #c8102e;border-radius:8px;outline:none}
    #srs-scan:focus{box-shadow:0 0 0 3px rgba(200,16,46,.2)}
    #srs-go{background:#c8102e;color:#fff;border:none;border-radius:8px;padding:0 18px;font:600 15px system-ui;cursor:pointer}
    #srs-go:hover{background:#a50d26}
    #srs-status{padding:8px 12px;border-radius:6px;margin-bottom:10px;font-weight:600;min-height:18px;display:none}
    #srs-status.ok{background:#e6f7ea;color:#137333;display:block}
    #srs-status.err{background:#fce8e6;color:#c5221f;display:block}
    #srs-status.info{background:#e8f0fe;color:#1a56c4;display:block}
    #srs-counts{margin:6px 0 12px;font-weight:600;color:#333}
    table.srs-tbl{width:100%;border-collapse:collapse}
    table.srs-tbl th,table.srs-tbl td{border:1px solid #ddd;padding:7px 9px;text-align:left;font-size:13px;vertical-align:top}
    table.srs-tbl th{background:#f4f4f4}
    tr.srs-notfound td{background:#fff4f4}
    .srs-del{color:#c5221f;cursor:pointer;font-weight:700;border:none;background:none;font-size:15px}
    #srs-foot{padding:14px 18px;border-top:1px solid #eee;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
    .srs-btn{border:none;border-radius:8px;padding:10px 16px;font:600 14px system-ui;cursor:pointer}
    .srs-btn.primary{background:#137333;color:#fff}
    .srs-btn.primary:hover{background:#0f5c28}
    .srs-btn.ghost{background:#eee;color:#333}
    .srs-btn.ghost:hover{background:#ddd}
    .srs-badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700}
    .srs-badge.ok{background:#e6f7ea;color:#137333}
    .srs-badge.no{background:#fce8e6;color:#c5221f}
  `;

  function injectStyle() {
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function buildUI() {
    const fab = document.createElement('button');
    fab.id = 'srs-fab';
    fab.textContent = 'Returns search';
    document.body.appendChild(fab);

    const overlay = document.createElement('div');
    overlay.id = 'srs-overlay';
    overlay.innerHTML = `
      <div id="srs-modal">
        <div id="srs-head">
          <h2>Returned consignments scanner</h2>
          <button id="srs-close" title="Close">&times;</button>
        </div>
        <div id="srs-body">
          <div id="srs-scanwrap">
            <input id="srs-scan" placeholder="Scan a barcode here (RET...)" autocomplete="off" />
            <button id="srs-go" title="Search">Search</button>
          </div>
          <div id="srs-status"></div>
          <div id="srs-counts"></div>
          <table class="srs-tbl">
            <thead><tr>
              <th style="width:28px">#</th>
              <th>Waybill</th>
              <th>Reference 1</th>
              <th>Recipient name</th>
              <th>Recipient address</th>
              <th>Sender name</th>
              <th>Sender address</th>
              <th style="width:48px">Parcels</th>
              <th style="width:74px">Order no.</th>
              <th style="width:84px">Date</th>
              <th>Status</th>
              <th style="width:40px" title="Search result">Result</th>
              <th style="width:28px"></th>
            </tr></thead>
            <tbody id="srs-rows"></tbody>
          </table>
        </div>
        <div id="srs-foot">
          <button class="srs-btn ghost" id="srs-clear">Clear list</button>
          <button class="srs-btn ghost" id="srs-csv">Download CSV</button>
          <button class="srs-btn primary" id="srs-export">Download Excel (.xlsx)</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const scan = overlay.querySelector('#srs-scan');
    const statusEl = overlay.querySelector('#srs-status');

    const setStatus = (msg, kind) => {
      statusEl.className = kind || 'info';
      statusEl.textContent = msg;
      if (kind === 'ok' || kind === 'info') {
        clearTimeout(setStatus._t);
        setStatus._t = setTimeout(() => { statusEl.style.display = 'none'; statusEl.textContent = ''; }, 2500);
      }
    };

    const open = () => {
      overlay.classList.add('open');
      disableDateFilters();
      clearInterferingFields();
      setTimeout(() => scan.focus(), 50);
    };
    const close = () => overlay.classList.remove('open');

    fab.addEventListener('click', open);
    overlay.querySelector('#srs-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Handle a scan (Enter from the barcode reader, or the Search button)
    const submit = () => { const raw = scan.value; scan.value = ''; enqueueScan(raw, setStatus); };
    scan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    overlay.querySelector('#srs-go').addEventListener('click', submit);

    overlay.querySelector('#srs-clear').addEventListener('click', () => {
      if (scans.length && !confirm('Clear the whole list?')) return;
      scans.length = 0;
      renderRows();
      scan.focus();
    });
    overlay.querySelector('#srs-export').addEventListener('click', () => exportXlsx(setStatus));
    overlay.querySelector('#srs-csv').addEventListener('click', () => exportCsv(setStatus));

    return { overlay, scan, setStatus };
  }

  let ui;

  function enqueueScan(raw, setStatus) {
    const num = cleanScan(raw);
    if (!num) { setStatus('Empty or invalid scan.', 'err'); return; }
    if (scans.some((s) => s.waybill === num && s.status !== 'notfound')) {
      setStatus('Already scanned: ' + num, 'info');
      return;
    }
    queue.push({ raw, num, setStatus });
    drainQueue();
  }

  async function drainQueue() {
    if (processing) return;
    processing = true;
    while (queue.length) {
      const { raw, num, setStatus } = queue.shift();
      setStatus('Searching ' + num + '...', 'info');
      let res;
      try { res = await searchWaybill(num); } catch (err) { res = { status: 'error', msg: String(err) }; }

      if (res.status === 'found') {
        scans.push({ waybill: res.waybill, ref1: res.ref1, receiver: res.receiver, receiverAddr: res.receiverAddr, sender: res.sender, senderAddr: res.senderAddr, packages: res.packages, order: res.order, date: res.date, statusText: res.statusText, status: 'found', raw, time: new Date(), multiple: res.multiple });
        const extra = res.multiple ? ` (warning: ${res.multiple} rows matched)` : '';
        setStatus(`Found ${res.waybill} - ${res.ref1 || '(no Reference 1)'}${extra}`, 'ok');
      } else if (res.status === 'notfound') {
        scans.push({ waybill: num, ref1: '', receiver: '', receiverAddr: '', sender: '', senderAddr: '', packages: '', order: '', date: '', statusText: '', status: 'notfound', raw, time: new Date() });
        setStatus('Not found: ' + num, 'err');
      } else if (res.status === 'timeout') {
        scans.push({ waybill: num, ref1: '', receiver: '', receiverAddr: '', sender: '', senderAddr: '', packages: '', order: '', date: '', statusText: '', status: 'timeout', raw, time: new Date() });
        setStatus('Timed out: ' + num, 'err');
      } else {
        setStatus('Error: ' + (res.msg || 'unknown'), 'err');
      }
      renderRows();
    }
    processing = false;
    if (ui) ui.scan.focus();
  }

  function renderRows() {
    const tbody = document.querySelector('#srs-rows');
    if (!tbody) return;
    tbody.innerHTML = '';
    scans.forEach((s, idx) => {
      const tr = document.createElement('tr');
      if (s.status !== 'found') tr.className = 'srs-notfound';
      const badge = s.status === 'found'
        ? '<span class="srs-badge ok">OK</span>'
        : `<span class="srs-badge no">${s.status === 'timeout' ? 'timeout' : 'none'}</span>`;
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${esc(s.waybill)}</td>
        <td>${esc(s.ref1)}</td>
        <td>${esc(s.receiver)}</td>
        <td>${esc(s.receiverAddr)}</td>
        <td>${esc(s.sender)}</td>
        <td>${esc(s.senderAddr)}</td>
        <td>${esc(s.packages)}</td>
        <td>${esc(s.order)}</td>
        <td>${esc(s.date)}</td>
        <td>${esc(s.statusText)}</td>
        <td>${badge}</td>
        <td><button class="srs-del" title="Remove" data-i="${idx}">×</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.srs-del').forEach((b) =>
      b.addEventListener('click', (e) => {
        scans.splice(+e.target.dataset.i, 1);
        renderRows();
      })
    );
    const found = scans.filter((s) => s.status === 'found').length;
    const bad = scans.length - found;
    const c = document.querySelector('#srs-counts');
    if (c) c.textContent = `Scans: ${scans.length}   Found: ${found}   Problems: ${bad}`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  // One row source for both exports - same data, two formats.
  function buildRows() {
    return scans.map((s, i) => ({
      'No.': i + 1,
      'Waybill': s.waybill,
      'Reference 1': s.ref1,
      'Recipient name': s.receiver,
      'Recipient address': s.receiverAddr,
      'Sender name': s.sender,
      'Sender address': s.senderAddr,
      'Parcels': s.packages,
      'Order no.': s.order,
      'Date': s.date,
      'Status': s.statusText,
      'Result': s.status === 'found' ? 'found' : (s.status === 'timeout' ? 'timeout' : 'not found'),
      'Raw scan': s.raw,
      'Scanned at': s.time ? s.time.toLocaleString('en-GB') : '',
    }));
  }

  function stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }

  function exportCsv(setStatus) {
    if (!scans.length) { setStatus('The list is empty.', 'err'); return; }
    const rows = buildRows();
    const headers = Object.keys(rows[0]);
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    // BOM so Excel reads the UTF-8 Cyrillic data correctly.
    const csv = '\ufeff' + [headers.map(q).join(',')]
      .concat(rows.map((r) => headers.map((h) => q(r[h])).join(',')))
      .join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `speedy-returns-${stamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus('CSV file generated.', 'ok');
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
    ws['!cols'] = [{ wch: 5 }, { wch: 16 }, { wch: 30 }, { wch: 26 }, { wch: 40 }, { wch: 26 }, { wch: 40 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Returns');
    XLSX.writeFile(wb, `speedy-returns-${stamp()}.xlsx`);
    setStatus('Excel file generated.', 'ok');
  }

  /* ===================== BOOT ===================== */
  function init() {
    injectStyle();
    ui = buildUI();
    renderRows();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();