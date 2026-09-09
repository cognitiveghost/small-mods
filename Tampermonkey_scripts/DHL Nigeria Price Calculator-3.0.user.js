// ==UserScript==
// @name         DHL Nigeria Price Calculator
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Smart price distribution for Nigeria customs (<=200 EUR total, <=50 EUR per item)
// @match        https://app2.dhlexpresscommerce.com/orders/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Nigeria customs limits. Tune here if the rules change.
    const LIMITS = { MAX_TOTAL: 200, MAX_PER_ITEM: 50, MIN_PRICE: 1 };

    /* ══════════════════ PURE LOGIC (no DOM — see test_nigeria.mjs) ══════════════════
     * items: [{ qty, price }]  ->  { mode, prices: number[], iterations, error }
     * mode: 'cap'   every price capped at MAX_PER_ITEM was enough
     *       'smart' cheap items kept, expensive ones share the leftover budget
     *       'flat'  everything is cheap yet still over budget -> spread evenly
     */
    function computePrices(items, L) {
        L = L || LIMITS;
        const { MAX_TOTAL, MAX_PER_ITEM, MIN_PRICE } = L;
        // Round DOWN: toFixed() rounds up and 3 x 66.67 = 200.01 would breach the limit.
        const money = (n) => Math.floor(n * 100) / 100;

        if (!items.length) return { error: 'No items.' };

        // Single exit: nothing leaves here that would breach the customs limits.
        const finish = (mode, prices, iterations) => {
            const sum = prices.reduce((s, p, i) => s + p * work[i].qty, 0);
            if (sum > MAX_TOTAL + 1e-9 || prices.some((p) => p <= 0 || p > MAX_PER_ITEM + 1e-9)) {
                return { error: `Cannot fit these items under ${MAX_TOTAL} EUR total / ` +
                                `${MAX_PER_ITEM} EUR per item. Remove items or reduce quantities.` };
            }
            return { mode, prices, iterations };
        };

        // Step 0: zero prices are rejected by customs — floor them, and never divide by qty 0.
        const work = items.map((it) => ({
            qty: Math.max(1, it.qty || 1),
            price: it.price > 0 ? it.price : MIN_PRICE,
        }));
        const totalQty = work.reduce((s, it) => s + it.qty, 0);

        // Step 1: does a plain cap at MAX_PER_ITEM already fit?
        const capped = work.map((it) => Math.min(it.price, MAX_PER_ITEM));
        if (capped.reduce((s, p, i) => s + p * work[i].qty, 0) <= MAX_TOTAL) {
            return finish('cap', capped.map(money), 0);
        }

        // Step 2: keep the cheap items untouched, squeeze the expensive ones into what is left.
        // Each pass promotes the dearest "cheap" item into the expensive pool, so it terminates.
        const expensive = work.map((it) => it.price > MAX_PER_ITEM);
        for (let iteration = 1; iteration <= work.length + 1; iteration++) {
            const cheapIdx = work.map((_, i) => i).filter((i) => !expensive[i]);

            if (!cheapIdx.length) {
                const per = money(MAX_TOTAL / totalQty);
                return finish('flat', work.map(() => per), iteration);
            }

            const cheapTotal = cheapIdx.reduce((s, i) => s + work[i].price * work[i].qty, 0);
            const expQty = work.reduce((s, it, i) => s + (expensive[i] ? it.qty : 0), 0);
            const perUnit = (MAX_TOTAL - cheapTotal) / expQty;

            const dearestCheap = cheapIdx.reduce((a, b) => (work[b].price > work[a].price ? b : a));
            if (perUnit < work[dearestCheap].price) {
                expensive[dearestCheap] = true;   // promote and retry
                continue;
            }

            const per = money(perUnit);
            return finish('smart', work.map((it, i) => (expensive[i] ? per : money(it.price))), iteration);
        }
        return { error: 'Distribution did not converge.' };
    }

    /* ══════════════════ DOM ══════════════════ */

    const GRID = '.ssit-order-detail-grid.order-items';

    function readRows() {
        return [...document.querySelectorAll(GRID + ' tbody tr[data-index]')].map((row, index) => {
            const val = (sel) => { const el = row.querySelector(sel); return el ? el.value.trim() : ''; };
            // Some locales render prices as "12,50".
            const price = parseFloat(val('td[data-col-index="3"] input.ssit-input-text').replace(',', '.'));
            const qty = parseInt(val('td[data-col-index="2"] input.ssit-input-numeric'), 10);
            return {
                name: val('td[data-col-index="0"] input.k-input-inner'),
                sku: val('td[data-col-index="1"] input.k-input-inner'),
                qty: isNaN(qty) || qty < 1 ? 1 : qty,
                price: isNaN(price) ? 0 : price,
                input: row.querySelector('td[data-col-index="3"] input.ssit-input-text'),
                index,
            };
        });
    }

    function writePrice(input, value) {
        if (!input) return;
        input.value = value.toFixed(2);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function redistributePrices() {
        const items = readRows();
        if (!items.length) { alert('No items found in the order.'); return; }

        const before = items.reduce((s, it) => s + it.price * it.qty, 0);
        const res = computePrices(items.map((it) => ({ qty: it.qty, price: it.price })), LIMITS);

        if (res.error) { alert(res.error); return; }

        const changes = [];
        let after = 0;
        items.forEach((it, i) => {
            const p = res.prices[i];
            writePrice(it.input, p);
            after += p * it.qty;
            if (Math.abs(p - it.price) > 0.005) {
                changes.push(`  ${it.name || it.sku || 'Item ' + (i + 1)} (x${it.qty}): ` +
                             `${it.price.toFixed(2)} -> ${p.toFixed(2)} EUR`);
            }
        });

        const MODE = { cap: 'capped at 50 EUR', smart: 'smart distribution', flat: 'spread evenly' };
        alert(
            'Done - ' + MODE[res.mode] + '\n\n' +
            'Original total: ' + before.toFixed(2) + ' EUR\n' +
            'New total:      ' + after.toFixed(2) + ' EUR (limit ' + LIMITS.MAX_TOTAL + ' EUR)\n' +
            'Items changed:  ' + changes.length + ' of ' + items.length +
            (changes.length ? '\n\nChanges:\n' + changes.join('\n') : '')
        );
    }

    function addButton() {
        if (document.getElementById('nigeria-calc-button')) return;
        const button = document.createElement('button');
        button.id = 'nigeria-calc-button';
        button.textContent = 'Calculate Nigeria Prices';
        button.style.cssText = `position:fixed;top:15px;left:100px;z-index:9999;padding:12px 20px;
            background:#008751;color:#fff;border:none;border-radius:6px;cursor:pointer;
            font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,.2)`;
        button.addEventListener('mouseover', () => button.style.background = '#006d40');
        button.addEventListener('mouseout', () => button.style.background = '#008751');
        button.addEventListener('click', redistributePrices);
        document.body.appendChild(button);
    }

    // Node (test harness) has no DOM — expose the pure part and stop here.
    if (typeof document === 'undefined') { module.exports = { computePrices, LIMITS }; return; }

    // The grid is rendered client-side; watch instead of polling forever.
    if (location.pathname.includes('/orders/')) {
        if (document.querySelector(GRID)) addButton();
        new MutationObserver(() => { if (document.querySelector(GRID)) addButton(); })
            .observe(document.body, { childList: true, subtree: true });
    }
})();
