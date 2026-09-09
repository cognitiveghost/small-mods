// Self-check for tracking-number -> courier detection. Run: node test_providers.js
const assert = require('assert');
const { detectProvider } = require('./auto-poste-italiane.user.js');

const cases = [
    ['3UW123456789',             'poste-italiane'],
    ['H00TCA0001234',            'evri'],
    ['3SBPB0123456789',          'bpost'],
    ['LY123456789DE',            'deutsche-post'],
    ['LM123456789SE',            'postnord'],
    ['LS123456789FR',            'asendia'],
    ['1042' + '1'.repeat(18),    'austria-post'],     // 22 chars
    ['633' + '1'.repeat(20),     'correos-express'],  // 23 chars
    ['323' + '1'.repeat(20),     'correos'],          // 23 chars
    ['7000' + '1'.repeat(9),     'fan-courier'],      // 13 chars
    ['  3uw123456789  ',         'poste-italiane'],   // trimmed + upper-cased
    ['LY12345678DE',             ''],                 // 8 digits, not 9
    ['1042' + '1'.repeat(17),    ''],                 // 21 chars, wrong length
    ['633' + '1'.repeat(19),     ''],                 // 22 chars, wrong length
    ['7000' + '1'.repeat(10),    ''],                 // 14 chars, wrong length
    ['ZZ999',                    ''],
    ['',                         ''],
    [null,                       ''],
];

for (const [input, expected] of cases) {
    assert.strictEqual(detectProvider(input), expected,
        `detectProvider(${JSON.stringify(input)}) -> ${detectProvider(input)}, expected ${expected || '(none)'}`);
}

// 3SBPB must win over the looser 3UW/323 neighbours regardless of table order.
assert.strictEqual(detectProvider('3SBPB' + '1'.repeat(18)), 'bpost');

console.log(`courier detection: ${cases.length + 1}/${cases.length + 1} ok`);
