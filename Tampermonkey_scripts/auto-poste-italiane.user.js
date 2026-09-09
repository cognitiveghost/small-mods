// ==UserScript==
// @name         Auto Courier Provider
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Автоматично визначає кур'єра по тракінг-номеру і зберігає
// @match        */wp-admin/post.php?post=*&action=edit*
// @match        */wp-admin/admin.php?page=wc-orders&action=edit*
// @grant        none
// ==/UserScript==

/* globals jQuery */

(function () {
    'use strict';

    // Tracking-number formats, first match wins. Adding a courier = adding one line.
    // Kept as data so the list stays readable as it grows; see test_providers.js.
    const PROVIDERS = [
        [/^3UW/,                  'poste-italiane'],
        [/^H00TCA/,               'evri'],
        [/^3SBPB/,                'bpost'],            // DHL via B-POST
        [/^LY\d{9}[A-Z]{2}$/,     'deutsche-post'],
        [/^LM\d{9}[A-Z]{2}$/,     'postnord'],
        [/^LS\d{9}[A-Z]{2}$/,     'asendia'],
        [/^1042.{18}$/,           'austria-post'],     // 22 chars
        [/^633.{20}$/,            'correos-express'],  // 23 chars
        [/^323.{20}$/,            'correos'],          // 23 chars
        [/^7000.{9}$/,            'fan-courier'],      // 13 chars
    ];

    function detectProvider(tracking) {
        const t = String(tracking || '').trim().toUpperCase();
        const hit = PROVIDERS.find(([re]) => re.test(t));
        return hit ? hit[1] : '';
    }

    if (typeof document === 'undefined') { module.exports = { detectProvider }; return; }

    function setProvider(select, value) {
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
        if (!tracking) { alert('Tracking number порожній!'); return; }

        if (providerSelect && !providerSelect.value) {
            const provider = detectProvider(tracking);
            if (provider) setProvider(providerSelect, provider);
        }

        if (providerSelect && !providerSelect.value) {
            alert('Невідомий формат тракінгу (' + tracking + ').\nВиберіть провайдера вручну.');
            return;
        }

        // Let the select2/change handlers settle before submitting.
        setTimeout(() => { if (saveButton) saveButton.click(); }, 100);
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
        btn.textContent = '📦 Quick Save';
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
