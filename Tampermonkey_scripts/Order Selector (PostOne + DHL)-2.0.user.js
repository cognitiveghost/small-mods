// ==UserScript==
// @name         Order Selector (PostOne + DHL)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Paste a list of order numbers and tick the matching rows. Replaces the separate PostOne and DHL selectors.
// @match        https://postone.eu/orders*
// @match        https://app2.dhlexpresscommerce.com/orders*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Per-site DOM contract. Everything else below is shared.
    const SITES = {
        'postone.eu': {
            label: 'Select PostOne orders',
            colour: '#28a745', hover: '#218838',
            ready: '#orders',
            rows: '#orders tbody tr',
            number: (row) => row.querySelector('td:nth-child(2)'),
            target: (row) => row.querySelector('td.select-checkbox'),
            isSelected: (row) => row.classList.contains('selected'),
            example: '12962\n12963\n12964',
        },
        'app2.dhlexpresscommerce.com': {
            label: 'Select DHL orders',
            colour: '#d40511', hover: '#b00410',
            ready: '.ssit-order-grid',
            rows: '.k-table-row.k-master-row',
            number: (row) => row.querySelector('a.order-number'),
            target: (row) => row.querySelector('input[type="checkbox"].k-grid-checkbox'),
            isSelected: (row) => !!row.querySelector('input[type="checkbox"].k-grid-checkbox')?.checked,
            example: '134386\n134385\n134384',
        },
    };

    const SITE = SITES[location.hostname];
    if (!SITE) return;

    // "#BG-12962" and " 12962 " both key to "BG12962" / "12962".
    const key = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    /* ── selection ──────────────────────────────────────────────────────── */
    function selectOrders(raw) {
        const wanted = new Map();               // key -> original text, deduped
        raw.split('\n').forEach((line) => {
            const k = key(line);
            if (k && !wanted.has(k)) wanted.set(k, line.trim());
        });
        if (!wanted.size) return show('No order numbers entered.', 'warn');

        let selected = 0, already = 0;
        const seen = new Set();

        document.querySelectorAll(SITE.rows).forEach((row) => {
            const cell = SITE.number(row);
            if (!cell) return;
            const k = key(cell.textContent);
            // Exact match only. Substring matching silently ticks #112962 for "12962".
            if (!wanted.has(k)) return;
            seen.add(k);
            if (SITE.isSelected(row)) { already++; return; }
            const target = SITE.target(row);
            if (target) { target.click(); selected++; }
        });

        // Reported against the SAME exact-match pass that did the selecting, so
        // "not found" can no longer disagree with what was actually ticked.
        const missing = [...wanted.keys()].filter((k) => !seen.has(k)).map((k) => wanted.get(k));

        let msg = `Selected ${selected} of ${wanted.size} order(s).`;
        if (already) msg += `\n${already} were already ticked.`;
        if (missing.length) {
            msg += `\n\n⚠️ Not on this page (${missing.length}):\n${missing.join(', ')}` +
                   `\n\nThese may be on another page of the table or outside the current filter.`;
        }
        show(msg, missing.length ? 'warn' : 'ok');
    }

    /* ── UI ─────────────────────────────────────────────────────────────── */
    const BTN = 'padding:9px 16px;border:none;border-radius:6px;cursor:pointer;font:600 14px system-ui,sans-serif';

    function show(msg, kind) {
        document.getElementById('os-toast')?.remove();
        const box = document.createElement('div');
        box.id = 'os-toast';
        box.textContent = msg + '\n\n(click to dismiss)';
        box.style.cssText = `position:fixed;top:70px;right:20px;z-index:100001;max-width:340px;
            padding:12px 16px;border-radius:8px;white-space:pre-wrap;cursor:pointer;
            font:13px/1.45 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);
            background:${kind === 'ok' ? '#137333' : '#8a5a00'};color:#fff`;
        box.addEventListener('click', () => box.remove());
        document.body.appendChild(box);
        if (kind === 'ok') setTimeout(() => box.remove(), 6000);
    }

    function openDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);
            display:flex;align-items:center;justify-content:center`;
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:10px;padding:20px;width:420px;max-width:90vw;
                        font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.3)">
              <div style="font-weight:700;font-size:16px;margin-bottom:6px">${SITE.label}</div>
              <div style="color:#555;margin-bottom:10px">One order number per line. A leading
                  <code>#</code> is ignored.</div>
              <textarea id="os-in" rows="10" spellcheck="false"
                  placeholder="${SITE.example.replace(/\n/g, '&#10;')}"
                  style="width:100%;box-sizing:border-box;resize:vertical;padding:8px;
                         border:1px solid #ccc;border-radius:6px;font:13px monospace"></textarea>
              <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
                <button id="os-cancel" style="${BTN};background:#eee;color:#333">Cancel</button>
                <button id="os-run" style="${BTN};background:${SITE.colour};color:#fff">Select</button>
              </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('#os-cancel').addEventListener('click', close);
        overlay.querySelector('#os-run').addEventListener('click', () => {
            const raw = overlay.querySelector('#os-in').value;
            close();
            selectOrders(raw);
        });
        // Ctrl/Cmd+Enter submits straight from the textarea.
        overlay.querySelector('#os-in').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) overlay.querySelector('#os-run').click();
        });
        overlay.querySelector('#os-in').focus();
    }

    function addButton() {
        if (document.getElementById('os-btn') || !document.querySelector(SITE.ready)) return;
        const b = document.createElement('button');
        b.id = 'os-btn';
        b.textContent = SITE.label;
        b.style.cssText = `${BTN};position:fixed;top:15px;right:20px;z-index:9999;padding:12px 20px;
            background:${SITE.colour};color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.2)`;
        b.addEventListener('mouseover', () => b.style.background = SITE.hover);
        b.addEventListener('mouseout', () => b.style.background = SITE.colour);
        b.addEventListener('click', openDialog);
        document.body.appendChild(b);
    }

    // Grids render client-side. Observe instead of the old unbounded setTimeout poll.
    addButton();
    new MutationObserver(addButton).observe(document.body, { childList: true, subtree: true });
})();
