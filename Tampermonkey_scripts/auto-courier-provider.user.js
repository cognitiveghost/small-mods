// ==UserScript==
// @name         Auto Courier Provider
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Detects the courier from the tracking number and saves the tracking info
// @match        */wp-admin/post.php?post=*&action=edit*
// @match        */wp-admin/admin.php?page=wc-orders&action=edit*
// @grant        none
// ==/UserScript==

/* globals jQuery */

(function () {
    'use strict';

    // Tracking-number format -> Advanced Shipment Tracking option value. First match wins.
    // The slugs are the plugin's REAL option values, verified against the live
    // #tracking_provider dropdown — see test_providers.js, which pins them.
    // Adding a courier = adding one line + one line in the test snapshot.
    const PROVIDERS = [
        [/^3UW/,                  'poste-italiane'],       // Poste Italiane (IT)
        [/^H00TCA/,               'evri'],                 // Evri (UK)
        [/^3SBPB/,                'belgium-post'],         // DHL via B-POST (BE)
        [/^LY\d{9}DE$/,           'deutsche-post'],        // Deutsche Post (DE)
        [/^LM\d{9}SE$/,           'postnord-sverige-ab'],  // PostNord (SE)
        [/^LS\d{9}[A-Z]{2}$/,     'asendia'],              // Asendia (global entry)
        [/^1042.{18}$/,           'post-at'],              // Austrian Post, 22 chars
        [/^633.{20}$/,            'correos-express'],      // Correos Express (ES), 23 chars
        [/^323.{20}$/,            'correos-spain'],        // Correos (ES), 23 chars
        [/^7000.{9}$/,            'fan-courier'],          // FAN Courier (RO), 13 chars
    ];

    function detectProvider(tracking) {
        const t = String(tracking || '').trim().toUpperCase();
        const hit = PROVIDERS.find(([re]) => re.test(t));
        return hit ? hit[1] : '';
    }

    // The dropdown is the source of truth, not this file. Resolving against it means a
    // renamed slug surfaces as a clear message instead of silently selecting nothing.
    function optionFor(select, slug) {
        const flat = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
        const opts = [...select.options].filter((o) => o.value);
        return opts.find((o) => o.value.toLowerCase() === slug) ||
               opts.find((o) => flat(o.value) === flat(slug)) || null;
    }

    if (typeof document === 'undefined') { module.exports = { detectProvider, optionFor, PROVIDERS }; return; }

    function setProvider(select, value) {
        // The field is a select2; jQuery .trigger('change') is what redraws the widget.
        if (typeof jQuery !== 'undefined') {
            jQuery(select).val(value).trigger('change');
        } else {
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function processTracking(widget) {
        const trackingInput = document.getElementById('tracking_number');
        const providerSelect = document.getElementById('tracking_provider');
        const saveButton = widget.querySelector('.button-save-form');

        const tracking = trackingInput ? trackingInput.value.trim() : '';
        if (!tracking) { alert('The tracking number field is empty.'); return; }
        if (!providerSelect) { alert('The "Provider" field was not found on this page.'); return; }

        // A provider picked by hand always wins — never overwrite the operator.
        if (!providerSelect.value) {
            const slug = detectProvider(tracking);
            if (!slug) {
                alert('Unrecognised tracking number format: ' + tracking +
                      '\n\nSelect the provider manually.');
                return;
            }

            const option = optionFor(providerSelect, slug);
            if (!option) {
                // Detection worked; the plugin simply has no such provider. Saying "unknown
                // tracking format" here sends the operator hunting a bug that does not exist.
                console.warn('[provider] "' + slug + '" is not in the dropdown. Similar values:',
                    [...providerSelect.options]
                        .filter((o) => o.value && o.value.toLowerCase().includes(slug.split('-')[0]))
                        .map((o) => o.value + ' | ' + o.textContent.trim()));
                alert('Detected the courier as "' + slug + '", but there is no such ' +
                      'provider in the list.\n\n' +
                      'Select one manually, or add it under\n' +
                      'WooCommerce > Settings > Shipping > Shipment Tracking.\n\n' +
                      'Similar entries are listed in the browser console.');
                return;
            }

            setProvider(providerSelect, option.value);

            if (!providerSelect.value) {
                alert('Could not set the provider to "' + option.value + '".\n\nSelect it manually.');
                return;
            }
        }

        if (!saveButton) { alert('The "Save Tracking" button was not found.'); return; }
        // Let the select2/change handlers settle before submitting.
        setTimeout(() => saveButton.click(), 100);
    }

    function init() {
        const widget = document.getElementById('woocommerce-advanced-shipment-tracking');
        if (!widget || document.getElementById('quick-save-tracking')) return;

        const addBtn = widget.querySelector('.button-show-tracking-form');
        if (!addBtn) return;

        const btn = document.createElement('button');
        btn.id = 'quick-save-tracking';
        btn.type = 'button';
        btn.className = 'button button-primary btn_ast2';
        btn.textContent = 'Quick Save';
        btn.style.cssText = 'margin-top:10px;margin-left:10px;background:#28a745;border-color:#28a745';
        addBtn.parentNode.insertBefore(btn, addBtn.nextSibling);

        btn.addEventListener('click', () => {
            const form = document.getElementById('advanced-shipment-tracking-form');
            const hidden = !form || form.offsetParent === null ||
                           getComputedStyle(form).display === 'none';
            if (hidden) {
                addBtn.click();                                    // open the form first
                setTimeout(() => processTracking(widget), 300);
            } else {
                processTracking(widget);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
