// ==UserScript==
// @name         WooCommerce Order Shipment Creator
// @namespace    http://tampermonkey.net/
// @version      1.5
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

    // ─── MATCHING (pure — see test_shipments.js) ─────────────────────────────
    // Exactly TWO ways to refer to an order, both exact:
    //   post id        14157     <- the shipment EXPORT column, and the only id the
    //                              order page itself answers to (?post=/?id=)
    //   order number   UK10861   <- what the orders grid displays
    // These are independent sequences: #UK10861 lives at ?id=14157. The old
    // /^#?(\d+)/ recognised neither on a prefixed store, so every order came back
    // "not found".
    //
    // A prefix-stripped "10861" is deliberately NOT accepted. It cannot be told apart
    // from a post id, so on a plain-numeric store it could resolve to a different
    // order — i.e. a shipment for the wrong customer. Paste the grid number or the
    // post id; both are unambiguous.
    const normKey = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };

    // A row reads "#UK10861 Tatiana Silva" — number and customer name separated by a
    // SINGLE space, so splitting on whitespace runs the name into the key. Take the
    // leading token instead.
    function parseOrderNumber(text) {
        const m = String(text || '').trim().match(/^#?\s*([A-Za-z0-9][A-Za-z0-9\-_\/]*)/);
        return m ? m[1] : '';
    }

    /**
     * @param {Array}  rows       [{label:'UK10861', id:'14157', url:'…'}]
     * @param {Array}  requested  raw pasted lines
     * @returns {{found:Array, notFound:Array, ambiguous:Array, duplicates:Array}}
     */
    function matchOrders(rows, requested) {
        const index = {};   // key -> [row, …]
        const add = function (key, row) {
            if (!key) return;
            const list = index[key] = index[key] || [];
            if (list.indexOf(row) === -1) list.push(row);
        };

        rows.forEach(function (row) {
            add(normKey(row.label), row);    // UK10861  (orders grid)
            add(normKey(row.id), row);       // 14157    (export column)
        });

        const found = [], notFound = [], ambiguous = [], duplicates = [], taken = {};

        requested.forEach(function (raw) {
            const k = normKey(raw);
            if (!k) return;

            const hits = index[k] || [];
            if (!hits.length) { notFound.push(raw); return; }
            if (hits.length > 1) {
                // Only reachable on a plain-numeric store where one order's number is
                // another's post id. Refuse to guess rather than ship the wrong parcel.
                ambiguous.push(raw + ' → #' + hits.map(function (h) {
                    return h.label + ' (id ' + h.id + ')';
                }).join(', #'));
                return;
            }

            const row = hits[0];
            // The same order reached us twice — as UK10861 and 14157, or just pasted
            // twice. Without this the script opened a second tab for the same order.
            if (taken[row.id]) { duplicates.push(raw); return; }
            taken[row.id] = true;
            found.push(row);
        });

        return { found: found, notFound: notFound, ambiguous: ambiguous, duplicates: duplicates };
    }

    function readRows() {
        return [].slice.call(document.querySelectorAll('a.order-view')).map(function (link) {
            const strong = link.querySelector('strong');
            const label = parseOrderNumber((strong || link).textContent);
            // The queue is matched against the ?post=/?id= URL param on the order page,
            // so a row is only usable if we can read that id off its link.
            const idMatch = (link.getAttribute('href') || '').match(/[?&](?:post|id)=(\d+)/);
            return (label && idMatch) ? { label: label, id: idMatch[1], url: link.href } : null;
        }).filter(Boolean);
    }

    function onProcessClick() {
        const input = prompt(
            'Enter order numbers to process (one per line):\n\n' +
            'Accepts the order number (#UK10861) or the post id (14157),\n' +
            'the column the shipment export gives you.\n\nExample:\n#UK10861\n#UK10860'
        );
        if (!input) return;

        const requested = input.split('\n')
            .map(function (n) { return n.trim(); })
            .filter(Boolean);

        if (requested.length === 0) {
            alert('No order numbers entered.');
            return;
        }

        const rows = readRows();
        const res = matchOrders(rows, requested);
        const found = res.found, notFound = res.notFound,
              ambiguous = res.ambiguous, duplicates = res.duplicates;

        const problems = function () {
            let out = '';
            if (notFound.length) {
                out += '\n\n\u26a0\ufe0f Not found on this page (' + notFound.length + '):\n' +
                       notFound.join('\n') +
                       '\n\nNote: a number with its prefix stripped (10861 instead of ' +
                       'UK10861) is not accepted — use the grid number or the post id.';
            }
            if (ambiguous.length) {
                out += '\n\n\u26a0\ufe0f Ambiguous — these match more than one order, ' +
                       'paste the post id instead:\n' + ambiguous.join('\n');
            }
            if (duplicates.length) {
                out += '\n\n\u2139\ufe0f Skipped ' + duplicates.length + ' duplicate line(s) — ' +
                       'the same order was listed more than once:\n' + duplicates.join('\n');
            }
            return out;
        };

        if (found.length === 0) {
            alert('None of the entered orders were found on this page.' + problems() +
                  (rows.length ? '\n\nThis page shows ' + rows.length + ' orders, e.g. ' +
                                 rows.slice(0, 3).map(function (r) { return '#' + r.label; }).join(', ')
                               : '\n\nNo order rows were readable on this page at all.'));
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
        msg += problems();
        if (notFound.length) {
            msg += '\n\nMake sure these orders are visible on the current page/filter.';
        }
        toast(msg, opened === found.length && !notFound.length && !ambiguous.length);
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

    // Node (test harness) has no DOM — expose the pure part and stop here.
    if (typeof document === 'undefined') { module.exports = { matchOrders, parseOrderNumber }; return; }

    // ─── ENTRY POINT ─────────────────────────────────────────────────────────
    if (isOrdersListPage()) {
        initListPage();
    } else if (isOrderEditPage()) {
        initOrderPage();
    }

})();
