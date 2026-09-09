// ==UserScript==
// @name         Order Selector Shopify
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Select Shopify orders from a pasted list using ONE search query (no page-by-page crawling)
// @match        https://admin.shopify.com/store/*/orders*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // --- Confirmed against the live Shopify Polaris IndexTable -------------
    const ROW_SEL   = '.Polaris-Table-TableRow__Selectable';
    const SEL_CLASS = 'Polaris-Table-TableRow__Selected';
    const LINK_SEL  = 'a[href*="/orders/"]';
    const NEXT_LABEL = 'Next';
    const STORE_KEY = '__orderSelectorPending';   // survives the one reload

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ---------- normalisation & matching ----------------------------------
    // Rows read like "#BG7228". Accept "7228" / "BG7228" / "#BG7228".
    const fullKey  = s => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');   // -> "BG7228"
    const digitKey = s => { const m = s.match(/\d+/g); return m ? m.join('') : ''; }; // -> "7228"

    function getOrderName(row) {
        for (const a of row.querySelectorAll(LINK_SEL)) {
            const t = a.textContent.trim();
            if (/\d/.test(t)) return t;
        }
        return null;
    }

    function navButton(label) {
        return [...document.querySelectorAll('button')]
            .find(b => (b.getAttribute('aria-label') || '').trim().toLowerCase() === label.toLowerCase());
    }
    // Polaris pagination stays disabled === false on edge pages; it flags
    // disabled via aria-disabled / a CSS class instead.
    function isDisabled(btn) {
        return !btn || btn.disabled
            || btn.getAttribute('aria-disabled') === 'true'
            || btn.className.includes('Polaris-Button--disabled');
    }
    const firstHref = () => document.querySelector(ROW_SEL + ' ' + LINK_SEL)?.getAttribute('href') || null;

    async function waitForPageChange(prev, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            await sleep(200);
            const h = firstHref();
            if (h && h !== prev) { await sleep(400); return true; }
        }
        return false;
    }

    // ---------- UI: floating button ---------------------------------------
    function ensureButton() {
        if (document.getElementById('order-selector-btn')) return;
        const button = document.createElement('button');
        button.id = 'order-selector-btn';
        button.textContent = 'Select the orders';
        button.style.cssText = `
            position: fixed; top: 160px; right: 40px; z-index: 99999;
            padding: 12px 20px; background: #28a745; color: #fff; border: none;
            border-radius: 6px; cursor: pointer; font-weight: bold;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);`;
        button.addEventListener('mouseover', () => button.style.background = '#218838');
        button.addEventListener('mouseout',  () => button.style.background = '#28a745');
        button.addEventListener('click', openDialog);
        document.body.appendChild(button);
    }

    function openDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.45);
            display:flex;align-items:center;justify-content:center;`;
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:10px;padding:20px;width:440px;max-width:90vw;
                        box-shadow:0 10px 40px rgba(0,0,0,0.3);font:14px/1.4 sans-serif;">
                <div style="font-weight:700;font-size:16px;margin-bottom:8px;">Select the orders</div>
                <div style="color:#555;margin-bottom:10px;">Paste order numbers (one per line). Accepts
                    <code>7228</code>, <code>BG7228</code>, <code>#BG7228</code>.<br>
                    The script runs a single search, then ticks the exact matches.</div>
                <textarea id="os-input" rows="10" style="width:100%;box-sizing:border-box;resize:vertical;
                    padding:8px;border:1px solid #ccc;border-radius:6px;font:13px monospace;"
                    placeholder="#BG7228&#10;#BG7227&#10;#BG7226"></textarea>
                <div style="color:#888;font-size:12px;margin:8px 0;">Tip: for very long lists (50+),
                    run it in two batches and apply your bulk action between them.</div>
                <div style="display:flex;justify-content:flex-end;gap:8px;">
                    <button id="os-cancel" style="padding:8px 14px;border:1px solid #ccc;background:#f5f5f5;
                        border-radius:6px;cursor:pointer;">Cancel</button>
                    <button id="os-run" style="padding:8px 14px;border:none;background:#28a745;color:#fff;
                        border-radius:6px;cursor:pointer;font-weight:700;">Search &amp; select</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.querySelector('#os-cancel').addEventListener('click', close);
        overlay.querySelector('#os-input').focus();
        overlay.querySelector('#os-run').addEventListener('click', () => {
            const raw = overlay.querySelector('#os-input').value;
            close();
            startSearch(raw);
        });
    }

    // ---------- status overlay --------------------------------------------
    function makeStatus() {
        let box = document.getElementById('order-selector-status');
        if (!box) {
            box = document.createElement('div');
            box.id = 'order-selector-status';
            box.style.cssText = `position:fixed;top:120px;right:40px;z-index:99999;max-width:340px;
                padding:12px 16px;background:#1a1a1a;color:#fff;border-radius:8px;
                font:13px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.35);white-space:pre-wrap;`;
            document.body.appendChild(box);
        }
        const fn = msg => { box.textContent = msg; };
        fn.remove = () => box.remove();
        return fn;
    }

    // ---------- STEP 1: parse list, store it, run the search --------------
    function startSearch(raw) {
        const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
        if (!lines.length) { const s = makeStatus(); s('No order numbers entered.'); setTimeout(s.remove, 2500); return; }

        // Build unique targets. Each keeps the key used for matching + a search token.
        const seen = new Set();
        const targets = [];
        for (const raw1 of lines) {
            const full = fullKey(raw1), digits = digitKey(raw1);
            const id = full || digits;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const token = /[A-Z]/.test(full) ? full : digits;  // e.g. "BG7228" or "7228"
            targets.push({ raw: raw1, full, digits, token, matched: false });
        }
        if (!targets.length) { const s = makeStatus(); s('No valid numbers.'); setTimeout(s.remove, 2500); return; }

        // ONE query: "BG7228 OR BG7227 OR ..." — returns a small superset (plus
        // some fuzzy noise) that we later filter to exact matches.
        const query = targets.map(t => t.token).join(' OR ');

        sessionStorage.setItem(STORE_KEY, JSON.stringify({ targets, created: Date.now() }));

        // Keep the current view/path; just set the search query and reset paging.
        const url = new URL(location.href);
        url.searchParams.set('query', query);
        url.searchParams.delete('after');
        url.searchParams.delete('before');
        url.searchParams.delete('start');
        location.assign(url.toString());   // one reload; STEP 2 resumes after it
    }

    // ---------- STEP 2 (after reload): select exact matches ---------------
    async function resumeSelection(data) {
        const status = makeStatus();
        const targets = data.targets.map(t => ({ ...t, matched: false }));
        const total = targets.length;

        status('Loading search results…');
        // wait for the results table to render
        const start = Date.now();
        while (Date.now() - start < 15000 && document.querySelectorAll(ROW_SEL).length === 0) await sleep(300);
        await sleep(600);

        let selected = 0, page = 0;
        while (true) {
            page++;
            document.querySelectorAll(ROW_SEL).forEach(row => {
                const name = getOrderName(row); if (!name) return;
                const fk = fullKey(name), dk = digitKey(name);
                // Digits-only matching is a fallback for bare "7228" input. If the user
                // typed a prefix ("BG7228") it must match in full, otherwise "#XY7228"
                // on the same page gets ticked instead.
                const t = targets.find(x => !x.matched && (
                    x.full === fk ||
                    (!/[A-Z]/.test(x.full) && x.digits && x.digits === dk)
                ));
                if (t) {
                    if (!row.classList.contains(SEL_CLASS)) {
                        const cb = row.querySelector('input[type="checkbox"]');
                        if (cb && !cb.checked) { cb.click(); selected++; }
                    }
                    t.matched = true;
                }
            });
            status(`Selected ${selected} / ${total}…`);

            if (targets.every(t => t.matched)) break;   // got them all
            const next = navButton(NEXT_LABEL);
            if (isDisabled(next)) break;                 // no more result pages
            const h = firstHref();
            next.click();
            if (!await waitForPageChange(h)) break;
        }

        const notFound = targets.filter(t => !t.matched).map(t => t.raw);
        let msg = `Done. Selected ${selected} of ${total} orders.`;
        if (notFound.length) msg += `\n\nNot found (not in this view / no match):\n${notFound.join(', ')}`;
        msg += `\n\n(Click to dismiss)`;
        status(msg);
        document.getElementById('order-selector-status')
            .addEventListener('click', status.remove, { once: true });
    }

    // ---------- boot ------------------------------------------------------
    function boot() {
        ensureButton();
        const pending = sessionStorage.getItem(STORE_KEY);
        if (pending) {
            sessionStorage.removeItem(STORE_KEY);     // consume once
            try {
                const data = JSON.parse(pending);
                if (Date.now() - data.created < 120000 && Array.isArray(data.targets)) {
                    resumeSelection(data);
                }
            } catch (e) { /* ignore malformed */ }
        }
    }

    boot();
    // keep the button alive through SPA re-renders
    new MutationObserver(ensureButton).observe(document.body, { childList: true, subtree: false });
})();