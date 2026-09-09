// ==UserScript==
// @name         WooCommerce to Postone Auto-Fill [v2.7]
// @namespace    http://tampermonkey.net/
// @version      2.7
// @description  WooCommerce to Postone - Fixed values + Dynamic weight + Select2 fix
// @author       Dolphin
// @match        *://*/wp-admin/post.php?post=*&action=edit*
// @match        *://*/wp-admin/admin.php?page=wc-orders&action=edit*
// @match        https://postone.eu/*
// @match        https://*.postone.eu/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
    'use strict';

    console.log('[Postone Script v2.6] Loaded on:', window.location.href);

    // CONFIGURATION
    const CONFIG = {
        weightPerItem: 0.060, // Вага за 1 товар (кг) - 60 грамів
        // FIXED VALUES
        fixedProductDescription: 'Supplement Capsules',
        fixedProductQuantity: 1,
        fixedProductPrice: 9.99,
        fillDelay: 500
    };

    // COUNTRY MAPPING
    const COUNTRY_MAP = {
        'AF': '1', 'AL': '2', 'DZ': '3', 'AD': '5', 'AO': '6', 'AG': '9', 'AR': '10',
        'AM': '11', 'AW': '12', 'AU': '13', 'AT': '14', 'AZ': '15', 'BS': '16',
        'BH': '17', 'BD': '18', 'BB': '19', 'BY': '20', 'BE': '21', 'BZ': '22',
        'BJ': '23', 'BM': '24', 'BT': '25', 'BO': '26', 'BA': '27', 'BW': '28',
        'BR': '30', 'BN': '32', 'BG': '33', 'BF': '34', 'BI': '35', 'KH': '36',
        'CM': '37', 'CA': '38', 'CV': '39', 'KY': '40', 'CF': '41', 'TD': '42',
        'CL': '43', 'CN': '44', 'CO': '47', 'CG': '49', 'CK': '50', 'CR': '51',
        'HR': '52', 'CU': '53', 'CY': '54', 'CZ': '55', 'DK': '56', 'DJ': '57',
        'DM': '58', 'DO': '59', 'EC': '61', 'EG': '62', 'SV': '63', 'GQ': '64',
        'ER': '65', 'EE': '66', 'ET': '67', 'FJ': '70', 'FI': '71', 'FR': '72',
        'GA': '77', 'GM': '78', 'GE': '79', 'DE': '80', 'GH': '81', 'GI': '82',
        'GR': '84', 'GL': '85', 'GD': '86', 'GU': '88', 'GT': '89', 'GN': '90',
        'GW': '91', 'GY': '92', 'HT': '93', 'HN': '95', 'HK': '96', 'HU': '97',
        'IS': '98', 'IN': '99', 'ID': '101', 'IR': '102', 'IQ': '103', 'IE': '104',
        'IL': '105', 'IT': '106', 'CI': '107', 'JM': '109', 'JP': '110', 'JO': '111',
        'KZ': '112', 'KE': '113', 'KI': '114', 'KP': '115', 'KR': '116', 'KW': '118',
        'KG': '119', 'LA': '120', 'LV': '121', 'LB': '122', 'LS': '123', 'LR': '124',
        'LY': '125', 'LI': '126', 'LT': '127', 'LU': '128', 'MO': '129', 'MK': '130',
        'MG': '131', 'MW': '132', 'MY': '133', 'MV': '134', 'ML': '135', 'MT': '136',
        'MH': '137', 'MR': '139', 'MU': '140', 'MX': '142', 'FM': '143', 'MD': '144',
        'MC': '145', 'MN': '146', 'ME': '147', 'MS': '148', 'MA': '149', 'MZ': '150',
        'MM': '151', 'NA': '152', 'NR': '153', 'NP': '154', 'NL': '155', 'NC': '157',
        'NZ': '158', 'NI': '159', 'NE': '160', 'NG': '161', 'NO': '165', 'OM': '166',
        'PK': '167', 'PW': '168', 'PA': '170', 'PG': '171', 'PY': '172', 'PE': '173',
        'PH': '174', 'PL': '176', 'PT': '177', 'PR': '178', 'QA': '179', 'RO': '181',
        'RU': '182', 'RW': '183', 'KN': '184', 'LC': '185', 'VC': '186', 'WS': '187',
        'SM': '188', 'ST': '189', 'SA': '190', 'SN': '191', 'RS': '192', 'SC': '193',
        'SL': '194', 'SG': '195', 'SK': '196', 'SI': '197', 'SB': '198', 'SO': '199',
        'ZA': '200', 'ES': '202', 'LK': '203', 'SD': '206', 'SR': '207', 'SZ': '209',
        'SE': '210', 'CH': '211', 'SY': '212', 'TW': '213', 'TJ': '214', 'TZ': '215',
        'TH': '216', 'TG': '217', 'TO': '219', 'TT': '220', 'TN': '221', 'TR': '222',
        'TM': '223', 'TC': '224', 'TV': '225', 'UG': '226', 'UA': '227', 'AE': '228',
        'GB': '229', 'US': '230', 'UY': '232', 'UZ': '233', 'VU': '234', 'VE': '236',
        'VN': '237', 'VG': '238', 'VI': '239', 'YE': '242', 'ZM': '244', 'ZW': '245'
    };

    // WooCommerce page
    function initWooCommerce() {
        console.log('[WooCommerce] Checking order page...');

        if (!document.querySelector('input[name="_billing_email"]')) {
            console.log('[WooCommerce] Not an order page');
            return;
        }

        console.log('[WooCommerce] Order page found');

        const button = document.createElement('button');
        button.textContent = '📋 Copy for Postone';
        button.className = 'button button-primary button-large';
        button.style.cssText = 'margin: 10px; padding: 10px 20px; font-size: 14px;';

        const orderHeader = document.querySelector('.order_data_column');
        if (orderHeader) {
            orderHeader.insertBefore(button, orderHeader.firstChild);
            console.log('[WooCommerce] Button added');
        }

        button.addEventListener('click', function(e) {
            e.preventDefault();

            // Get quantity for dynamic weight calculation
            const productQuantity = getProductQuantity();

            // Get country code
            const countrySelect = document.querySelector('#_shipping_country');
            const countryCode = countrySelect ? countrySelect.value : '';

            console.log('[WooCommerce] Country:', countryCode);
            console.log('[WooCommerce] Quantity:', productQuantity);

            const orderData = {
                firstName: getValue('_shipping_first_name'),
                lastName: getValue('_shipping_last_name'),
                company: getValue('_shipping_company'),
                email: getValue('_billing_email'),
                phone: getValue('_billing_phone'),
                address1: getValue('_shipping_address_1'),
                address2: getValue('_shipping_address_2'),
                city: getValue('_shipping_city'),
                postcode: getValue('_shipping_postcode'),
                country: countryCode,
                state: getValue('_shipping_state'),
                orderNumber: extractOrderNumber(),
                // Product quantity for weight calculation
                productQuantity: productQuantity || 1,
                timestamp: Date.now(),
                consumed: false
            };

            GM_setValue('postoneOrderData', JSON.stringify(orderData));
            showNotification('✅ Data copied!', 'success');
            console.log('[WooCommerce] Data saved:', orderData);
        });
    }

    // Get product quantity
    function getProductQuantity() {
        const qtyInput = document.querySelector('input[name^="order_item_qty"]');
        return qtyInput ? parseInt(qtyInput.value) : 1;
    }

    // Postone page
    function initPostone() {
        console.log('[Postone] Initializing...');

        const modal = document.querySelector('#createShipment');

        if (!modal) {
            if (initPostone.tries === undefined) initPostone.tries = 0;
            if (++initPostone.tries > 15) {   // ~30s, then stop instead of polling forever
                console.log('[Postone] #createShipment never appeared — giving up.');
                return;
            }
            console.log('[Postone] Form not loaded yet...');
            setTimeout(initPostone, 2000);
            return;
        }

        console.log('[Postone] Form found');

        // Create button
        const fillButton = document.createElement('button');
        fillButton.textContent = '🔄 AUTO-FILL FROM WOOCOMMERCE';
        fillButton.className = 'btn btn-success';
        fillButton.style.cssText = `
            margin: 10px;
            width: calc(100% - 20px);
            padding: 15px;
            font-size: 16px;
            font-weight: bold;
            background: #28a745 !important;
            border: none !important;
        `;
        fillButton.id = 'woo-autofill-btn';
        fillButton.type = 'button';

        const modalBody = modal.querySelector('.modal-body');
        if (modalBody) {
            if (!document.querySelector('#woo-autofill-btn')) {
                modalBody.insertBefore(fillButton, modalBody.firstChild);
                console.log('[Postone] Button added!');
            }
        } else {
            console.log('[Postone] .modal-body not found');
            return;
        }

        // Button click
        fillButton.addEventListener('click', function(e) {
            e.preventDefault();

            const dataStr = GM_getValue('postoneOrderData', null);

            if (!dataStr) {
                alert('❌ No data from WooCommerce.\n\nFirst open an order and click "📋 Copy for Postone"');
                return;
            }

            let data;
            try { data = JSON.parse(dataStr); } catch (err) {
                alert('❌ Stored data is corrupted. Copy the order again.');
                return;
            }
            console.log('[Postone] Data loaded:', data);

            const mins = Math.round((Date.now() - data.timestamp) / 60000);
            if (mins > 60 && !confirm(
                `⚠️ Data for order #${data.orderNumber} was copied ${mins} minutes ago.\n\n` +
                `Fill the form with it anyway?`)) return;

            fillPostoneForm(data);
        });

        // Observer
        let wasVisible = false;
        const observer = new MutationObserver(function() {
            const isVisible = modal.style.display === 'block' ||
                            modal.classList.contains('show') ||
                            modal.classList.contains('in');

            if (!isVisible) { wasVisible = false; return; }
            if (wasVisible) return;          // the modal was already open — attribute noise
            wasVisible = true;

            const dataStr = GM_getValue('postoneOrderData', null);
            if (!dataStr) return;

            let data;
            try { data = JSON.parse(dataStr); } catch (e) { return; }

            if (data.consumed) {
                console.log('[Postone] Data already used for a shipment — not auto-filling again.');
                showNotification('ℹ️ Copy the order again to auto-fill', 'info');
                return;
            }
            if (data.timestamp <= Date.now() - (60 * 60 * 1000)) return;

            // Mark consumed BEFORE filling, so a reopened modal cannot reuse this address.
            data.consumed = true;
            GM_setValue('postoneOrderData', JSON.stringify(data));

            console.log('[Postone] Auto-filling...');
            setTimeout(() => fillPostoneForm(data), 1000);
        });

        observer.observe(modal, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });

        console.log('[Postone] Observer active');
    }

    // Fill form
    function fillPostoneForm(data) {
        console.log('[Postone] === FILLING FORM ===');

        const form = document.querySelector('#createShipmentForm');
        if (!form) {
            console.log('[Postone] Form not found!');
            return;
        }

        const fullName = `${data.firstName} ${data.lastName}`.trim();

        // Calculate weight based on quantity
        const calculatedWeight = (data.productQuantity || 1) * CONFIG.weightPerItem;
        console.log(`[Postone] Weight calculation: ${data.productQuantity} × ${CONFIG.weightPerItem} = ${calculatedWeight} kg`);

        setTimeout(() => {
            console.log('[Postone] Starting...\n');

            // 1. TEXT FIELDS
            setFieldValue('#name', fullName, 'Name');
            setFieldValue('#company_name', data.company, 'Company');
            setFieldValue('#street', data.address1, 'Address 1');
            setFieldValue('#street2', data.address2, 'Address 2');
            setFieldValue('#city', data.city, 'City');
            setFieldValue('#postal_code', data.postcode, 'Postal code');
            setFieldValue('#region', data.state, 'Region');
            setFieldValue('#email', data.email, 'Email');
            setFieldValue('#phone', data.phone, 'Phone');
            setFieldValue('#order_number', data.orderNumber, 'Order number');
            setFieldValue('#reference_number', `#${data.orderNumber}`, 'Reference');

            // 2. WEIGHT (DYNAMIC)
            setTimeout(() => {
                console.log('\n--- WEIGHT ---');
                setFieldValue('#weight', calculatedWeight, 'Weight (kg)');
            }, 100);

            // 3. COUNTRY
            setTimeout(() => {
                console.log('\n--- COUNTRY ---');
                if (data.country) {
                    setCountrySelect('#country_id', data.country, 'Country');
                } else {
                    console.log('⚠️ [Country] No country code');
                }
            }, 200);

            // 4. PHONE COUNTRY
            setTimeout(() => {
                console.log('\n--- PHONE COUNTRY ---');
                if (data.country) {
                    setCountrySelect('#phone_country_id', data.country, 'Phone country');
                } else {
                    console.log('⚠️ [Phone country] No country code');
                }
            }, 300);

            // 5. PRODUCT FIELDS (FIXED VALUES)
            setTimeout(() => {
                console.log('\n--- PRODUCT INFO (FIXED) ---');
                setSelect2Value('#content', CONFIG.fixedProductDescription, 'Product description');
                setFieldValue('#quantity', CONFIG.fixedProductQuantity, 'Quantity');
                setFieldValue('#unit_value', CONFIG.fixedProductPrice, 'Unit price');
            }, 400);

            // SUCCESS
            setTimeout(() => {
                showNotification('✅ Form filled!', 'success');
                console.log('\n[Postone] === COMPLETE ===');
            }, 600);

        }, CONFIG.fillDelay);
    }

    // Set text field
    function setFieldValue(selector, value, fieldName) {
        if (!value && value !== 0) {
            console.log(`⚠️ [${fieldName}] Empty value`);
            return false;
        }

        const element = document.querySelector(selector);
        if (!element) {
            console.log(`❌ [${fieldName}] Field ${selector} not found`);
            return false;
        }

        console.log(`✅ [${fieldName}] Setting: "${value}"`);

        try {
            element.focus();
            element.value = value;

            if (window.jQuery) {
                window.jQuery(element).val(value).trigger('input').trigger('change').trigger('blur');
            }

            ['input', 'change', 'blur'].forEach(eventType => {
                element.dispatchEvent(new Event(eventType, { bubbles: true }));
            });

            element.blur();
            return true;
        } catch (error) {
            console.log(`❌ [${fieldName}] Error:`, error);
            return false;
        }
    }

    // Set Select2 field (for #content)
    function setSelect2Value(selector, value, fieldName) {
        if (!value) {
            console.log(`⚠️ [${fieldName}] Empty value`);
            return false;
        }

        const select = document.querySelector(selector);
        if (!select) {
            console.log(`❌ [${fieldName}] Select ${selector} not found`);
            return false;
        }

        console.log(`🔄 [${fieldName}] Setting Select2: "${value}"`);

        try {
            // Create new option if doesn't exist
            let option = select.querySelector(`option[value="${value}"]`);
            if (!option) {
                option = document.createElement('option');
                option.value = value;
                option.text = value;
                option.selected = true;
                select.appendChild(option);
                console.log(`  ✅ Created new option: "${value}"`);
            } else {
                option.selected = true;
                console.log(`  ✅ Option exists, selected`);
            }

            // Trigger Select2 update
            if (window.jQuery) {
                window.jQuery(select).val(value).trigger('change');
                console.log(`  ✅ jQuery trigger executed`);
            }

            select.dispatchEvent(new Event('change', { bubbles: true }));

            console.log(`✅ [${fieldName}] Set to: "${value}"`);
            return true;
        } catch (error) {
            console.log(`❌ [${fieldName}] Error:`, error);
            return false;
        }
    }

    // Set country dropdown
    function setCountrySelect(selector, countryCode, fieldName) {
        if (!countryCode) {
            console.log(`⚠️ [${fieldName}] No country code`);
            return false;
        }

        const select = document.querySelector(selector);
        if (!select) {
            console.log(`❌ [${fieldName}] Select ${selector} not found`);
            return false;
        }

        const countryId = COUNTRY_MAP[countryCode];

        if (!countryId) {
            console.log(`⚠️ [${fieldName}] Country ${countryCode} not in mapping`);
            return false;
        }

        console.log(`✅ [${fieldName}] Setting: ${countryCode} (ID: ${countryId})`);

        try {
            select.value = countryId;

            if (window.jQuery) {
                window.jQuery(select).val(countryId).trigger('change');
            }

            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch (error) {
            console.log(`❌ [${fieldName}] Error:`, error);
            return false;
        }
    }

    // Helper functions
    function getValue(name) {
        const input = document.querySelector(`input[name="${name}"]`);
        return input ? input.value.trim() : '';
    }

    function extractOrderNumber() {
        const heading = document.querySelector('h2');
        if (heading && heading.textContent.includes('Order #')) {
            const match = heading.textContent.match(/Order #(\d+)/);
            return match ? match[1] : '';
        }
        const urlMatch = window.location.href.match(/(?:post|id)=(\d+)/);
        return urlMatch ? urlMatch[1] : '';
    }

    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 25px;
            background-color: ${type === 'success' ? '#4caf50' : '#2196F3'};
            color: white;
            border-radius: 5px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            z-index: 999999;
            font-size: 14px;
            font-weight: bold;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.transition = 'opacity 0.5s';
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    // Initialize
    const url = window.location.href;
    console.log('[Init] URL:', url);

    if (url.includes('wp-admin/post.php') || url.includes('page=wc-orders')) {
        console.log('[Init] WooCommerce');
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initWooCommerce);
        } else {
            initWooCommerce();
        }
    } else if (url.includes('postone.eu')) {
        console.log('[Init] Postone');
        setTimeout(initPostone, 1500);
    }

})();
