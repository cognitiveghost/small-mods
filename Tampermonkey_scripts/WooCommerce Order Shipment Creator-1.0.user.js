// ==UserScript==
// @name         WooCommerce Order Shipment Creator
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Opens orders from a list and auto-clicks Create Shipment on each order page
// @match        https://lidagreen.com/wp-admin/edit.php*
// @match        https://lidagreen.com/wp-admin/post.php*
// @match        https://lidagreen.com/wp-admin/admin.php*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const QUEUE_KEY = 'wc_shipment_queue';
    const QUEUE_TTL_MS = 10 * 60 * 1000;   // a queue older than this is abandoned, not replayed

    // ─── ORDERS LIST PAGE ────────────────────────────────────────────────────
    function isOrdersListPage() {
        const params = new URLSearchParams(window.location.search);
        // Legacy: edit.php?post_type=shop_order
        if (window.location.pathname.includes('edit.php') && params.get('post_type') === 'shop_order') return true;
        // HPOS: admin.php?page=wc-orders (list = no action=edit)
        if (window.location.pathname.includes('admin.php') && params.get('page') === 'wc-orders' && params.get('action') !== 'edit') return true;
        return false;
    }

    function initListPage() {
        waitForElement('#the-list', function () {
            addProcessButton();
        });
    }

    function addProcessButton() {
        const button = document.createElement('button');
        button.textContent = 'Process Orders';
        button.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            z-index: 99999;
            padding: 12px 20px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
            font-size: 13px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        `;
        button.addEventListener('mouseover', function () { button.style.background = '#218838'; });
        button.addEventListener('mouseout', function () { button.style.background = '#28a745'; });
        button.addEventListener('click', onProcessClick);
        document.body.appendChild(button);
    }

    function onProcessClick() {
        const input = prompt(
            'Enter order numbers to process (one per line):\n\nExample:\n#36576\n#36574\n#36573'
        );
        if (!input) return;

        // Parse order numbers — strip #, whitespace, empty lines
        const requested = input
            .split('\n')
            .map(function (n) { return n.trim().replace(/^#/, ''); })
            .filter(Boolean);

        if (requested.length === 0) {
            alert('No order numbers entered.');
            return;
        }

        // Build map of displayed orderNumber → {editURL, post/order id}.
        // The queue must hold the ID, because the order page identifies itself by the
        // ?post=/?id= URL param. Those match on a plain install but diverge as soon as a
        // sequential-order-number plugin renames #43075 to #BG-1042.
        const orderMap = {};
        document.querySelectorAll('a.order-view').forEach(function (link) {
            const strong = link.querySelector('strong');
            if (!strong) return;
            const match = strong.textContent.match(/^#?(\d+)/);
            if (!match) return;
            const idMatch = link.href.match(/[?&](?:post|id)=(\d+)/);
            orderMap[match[1]] = { url: link.href, id: idMatch ? idMatch[1] : match[1] };
        });

        const found = [];
        const notFound = [];

        requested.forEach(function (num) {
            if (orderMap[num]) {
                found.push({ num: num, url: orderMap[num].url, id: orderMap[num].id });
            } else {
                notFound.push(num);
            }
        });

        if (found.length === 0) {
            let msg = 'None of the entered orders were found on this page.';
            if (notFound.length > 0) {
                msg += '\n\nNot found:\n' + notFound.map(function (n) { return '#' + n; }).join('\n');
            }
            alert(msg);
            return;
        }

        if (found.length > 10 &&
            !confirm('This will open ' + found.length + ' tabs at once. Continue?')) return;

        const existingQueue = safeParseQueue();
        saveQueue(Array.from(new Set(existingQueue.concat(found.map(function (f) { return f.id; })))));

        // Opened synchronously: window.open must stay inside the click gesture or the
        // popup blocker drops every tab after the first.
        let opened = 0;
        found.forEach(function (order) {
            if (window.open(order.url, '_blank')) opened++;
        });

        let msg;
        if (opened < found.length) {
            msg = 'Opened only ' + opened + ' of ' + found.length + ' tabs — the popup blocker ' +
                  'stopped the rest.\nAllow pop-ups for this site, then run it again.';
        } else {
            msg = 'Opening ' + opened + ' order(s) for shipment creation.';
        }
        if (notFound.length > 0) {
            msg += '\n\n\u26a0\ufe0f Not found on this page (' + notFound.length + '):\n' +
                   notFound.map(function (n) { return '#' + n; }).join('\n') +
                   '\n\nMake sure these orders are visible on the current page/filter.';
        }
        toast(msg, opened === found.length && notFound.length === 0);
    }

    // ─── SINGLE ORDER PAGE ───────────────────────────────────────────────────
    function isOrderEditPage() {
        const params = new URLSearchParams(window.location.search);
        // Legacy: post.php?action=edit
        if (window.location.pathname.includes('post.php') && params.get('action') === 'edit') return true;
        // HPOS: admin.php?page=wc-orders&action=edit
        if (window.location.pathname.includes('admin.php') && params.get('page') === 'wc-orders' && params.get('action') === 'edit') return true;
        return false;
    }

    function initOrderPage() {
        const params = new URLSearchParams(window.location.search);
        const postId = params.get('post') || params.get('id');
        if (!postId) return;

        const queue = safeParseQueue();
        if (!queue.includes(postId)) return;

        // Consume the entry immediately. If the click then fails we say so out loud rather
        // than leaving the order armed to fire on the next manual visit.
        saveQueue(safeParseQueue().filter(function (id) { return id !== postId; }));

        waitForElement(
            'button[data-toggle="sksoftware-postone-for-woocommerce-shipment-create"]',
            function (btn) {
                if (btn) {
                    btn.click();
                } else {
                    toast('⚠️ Order #' + postId + ': "Create Shipment" button never appeared.\n' +
                          'Create this shipment manually.', false);
                }
            },
            10000
        );
    }

    // ─── UTILITIES ───────────────────────────────────────────────────────────
    // The queue is {ts, ids}. Anything older than QUEUE_TTL_MS is dropped, so a tab that
    // was never opened (popup blocked, browser closed) cannot silently fire days later.
    function safeParseQueue() {
        try {
            const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY));
            if (!parsed || !Array.isArray(parsed.ids)) return [];
            if (Date.now() - (parsed.ts || 0) > QUEUE_TTL_MS) {
                localStorage.removeItem(QUEUE_KEY);
                return [];
            }
            return parsed.ids;
        } catch (e) {
            return [];
        }
    }

    function saveQueue(ids) {
        if (!ids.length) { localStorage.removeItem(QUEUE_KEY); return; }
        localStorage.setItem(QUEUE_KEY, JSON.stringify({ ts: Date.now(), ids: ids }));
    }

    function toast(message, ok) {
        const el = document.createElement('div');
        el.textContent = message;
        el.style.cssText = 'position:fixed;top:60px;right:20px;z-index:999999;padding:12px 18px;' +
            'border-radius:6px;color:#fff;font:600 13px system-ui,sans-serif;max-width:320px;' +
            'box-shadow:0 4px 12px rgba(0,0,0,.3);white-space:pre-wrap;background:' +
            (ok ? '#28a745' : '#c5221f');
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, ok ? 4000 : 12000);
    }

    /**
     * Polls for a CSS selector until found or timeout reached.
     * @param {string} selector
     * @param {function} callback  Called with the found element
     * @param {number}  [timeout]  Max wait in ms (default 5000)
     */
    function waitForElement(selector, callback, timeout) {
        var maxWait = timeout || 5000;
        var waited = 0;
        var interval = 500;

        var el = document.querySelector(selector);
        if (el) {
            callback(el);
            return;
        }

        var timer = setInterval(function () {
            waited += interval;
            var el = document.querySelector(selector);
            if (el) {
                clearInterval(timer);
                callback(el);
            } else if (waited >= maxWait) {
                clearInterval(timer);
                callback(null);
            }
        }, interval);
    }

    // ─── ENTRY POINT ─────────────────────────────────────────────────────────
    if (isOrdersListPage()) {
        initListPage();
    } else if (isOrderEditPage()) {
        initOrderPage();
    }

})();
