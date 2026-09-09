// Self-check for tracking-number -> courier detection. Run: node test_providers.js
const assert = require('assert');
const { detectProvider, optionFor, PROVIDERS } = require('./auto-courier-provider.user.js');

const cases = [
    ['3UW123456789',             'poste-italiane'],
    ['H00TCA0001234',            'evri'],
    ['3SBPB0123456789',          'belgium-post'],
    ['LY123456789DE',            'deutsche-post'],
    ['LM123456789SE',            'postnord-sverige-ab'],
    ['LS123456789FR',            'asendia'],
    ['1042' + '1'.repeat(18),    'post-at'],          // 22 chars
    ['633' + '1'.repeat(20),     'correos-express'],  // 23 chars
    ['323' + '1'.repeat(20),     'correos-spain'],    // 23 chars
    ['7000' + '1'.repeat(9),     'fan-courier'],      // 13 chars
    ['  3uw123456789  ',         'poste-italiane'],   // trimmed + upper-cased
    ['LY12345678DE',             ''],                 // 8 digits, not 9
    ['1042' + '1'.repeat(17),    ''],                 // 21 chars, wrong length
    ['633' + '1'.repeat(19),     ''],                 // 22 chars, wrong length
    ['7000' + '1'.repeat(10),    ''],                 // 14 chars, wrong length
    ['ZZ999',                    ''],
    ['',                         ''],
    [null,                       ''],
    // Nordic PostNord prefixes other than SE map to DIFFERENT plugin values, so they
    // deliberately do not match — better "unknown" than silently filing a Danish
    // parcel under PostNord Sverige. Add a row per country when one actually ships.
    ['LM123456789DK',            ''],
    ['LM123456789NO',            ''],
    // LY is Deutsche Post's German-domestic form; a foreign suffix is not it.
    ['LY123456789FR',            ''],
];

for (const [input, expected] of cases) {
    assert.strictEqual(detectProvider(input), expected,
        `detectProvider(${JSON.stringify(input)}) -> ${detectProvider(input)}, expected ${expected || '(none)'}`);
}

// 3SBPB must win over the looser 3UW/323 neighbours regardless of table order.
assert.strictEqual(detectProvider('3SBPB' + '1'.repeat(18)), 'belgium-post');

/* ── The regression that mattered ─────────────────────────────────────────────
 * v1.2 shipped invented slugs ('bpost', 'austria-post', 'correos', 'postnord',
 * 'fan-courier'). None existed in the Advanced Shipment Tracking dropdown, so
 * setting them selected nothing and the script blamed the TRACKING FORMAT.
 * Snapshot of the real #tracking_provider option values (lidagreen.com, AST
 * plugin, verified 2026-09-09). Every slug we emit must resolve against it.
 * Refresh with, in the browser console on an order page:
 *   [...document.getElementById('tracking_provider').options].map(o=>o.value)
 */
const REAL_OPTIONS = [
    '', 'poste-italiane', 'evri', 'belgium-post', 'deutsche-post', 'deutsche-post-dhl',
    'postnord-sverige-ab', 'post-nord-denmark', 'postnord-norge', 'postnord-finland',
    'asendia', 'asendia-usa', 'asendia-de', 'asendia-uk', 'post-at', 'dpd-at', 'dhl-at',
    'gls-au', 'correos-express', 'correos-spain', 'dpd-romania', 'posta-romana',
    'gls-romania', 'cargus', 'sameday', 'dhl-parcel', 'fedex', 'ups', 'usps',
];
const fakeSelect = { options: REAL_OPTIONS.map((v) => ({ value: v })) };

const missing = PROVIDERS
    .map(([, slug]) => slug)
    .filter((slug) => !optionFor(fakeSelect, slug));

// FAN Courier genuinely has no entry in the plugin's list. It is detected on purpose
// so the operator gets "not in the provider list" instead of "unknown tracking format".
assert.deepStrictEqual(missing, ['fan-courier'],
    `these slugs do not exist in the provider dropdown: ${missing.join(', ')}`);

// Resolution is exact on value, and punctuation-insensitive as a fallback.
assert.strictEqual(optionFor(fakeSelect, 'belgium-post').value, 'belgium-post');
assert.strictEqual(optionFor(fakeSelect, 'postnordsverigeab').value, 'postnord-sverige-ab');
assert.strictEqual(optionFor(fakeSelect, 'nope-not-real'), null);
// The empty "Select Provider" option must never be chosen as a match.
assert.strictEqual(optionFor(fakeSelect, ''), null);

const extra = 6;
console.log(`courier detection: ${cases.length + extra}/${cases.length + extra} ok`);
