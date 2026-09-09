// Self-check for order-number matching. Run: node test_shipments.js
const assert = require('assert');
const { matchOrders, parseOrderNumber } = require('./WooCommerce Order Shipment Creator-1.0.user.js');

// Real shape from lidagreen.co.uk: displayed number and post id are INDEPENDENT
// sequences — #UK10861 lives at ?id=14157, not ?id=10861.
// Row text is taken verbatim from the live grid: the customer name follows the
// number after a SINGLE space. An earlier fixture used bare '#UK10861' and was
// clean enough to hide a parsing bug that broke every match on the real page.
const RAW = [
    ['#UK10861 Tatiana Silva',    '14157'],
    ['#UK10860 Rahela Bodea',     '14156'],
    ['#UK10859 Danuta Smoliniec', '14154'],
];
const rows = RAW.map(([text, id]) => ({ label: parseOrderNumber(text), id, url: 'u' + id }));
const ids = (r) => r.found.map((f) => f.id);

// Parsing must isolate the number and drop the name.
assert.strictEqual(parseOrderNumber('#UK10861 Tatiana Silva'), 'UK10861');
assert.strictEqual(parseOrderNumber('#43075 Ivana Sorace'), '43075');
assert.strictEqual(parseOrderNumber('  #UK-10861  Ann Lee '), 'UK-10861');
assert.strictEqual(parseOrderNumber(''), '');
assert.strictEqual(parseOrderNumber('   '), '');
assert.deepStrictEqual(rows.map((r) => r.label), ['UK10861', 'UK10860', 'UK10859']);

/* ── REGRESSION: the bug this file exists for ────────────────────────────────
 * v1.2 parsed row labels with /^#?(\d+)/. On a store whose numbers carry a
 * prefix that matched NOTHING, so the map came up empty and every single order
 * was reported "not found" — the script was completely dead on lidagreen.co.uk.
 */
assert.deepStrictEqual(ids(matchOrders(rows, ['#UK10861'])), ['14157'], 'prefixed number must match');

// The three ways an operator actually pastes the same order.
for (const form of ['#UK10861', 'UK10861', 'uk10861', ' #UK-10861 ', '10861']) {
    assert.deepStrictEqual(ids(matchOrders(rows, [form])), ['14157'], `form ${JSON.stringify(form)} must match`);
}

// The queue must carry the POST ID, never the displayed number — the order page
// identifies itself by ?post=/?id=, so queuing 10861 would never fire.
assert.deepStrictEqual(ids(matchOrders(rows, ['#UK10861', '#UK10859'])), ['14157', '14154']);

// Digits-only input is a fallback, so it must not silently pick one of two prefixes.
const collide = [
    { label: parseOrderNumber('#UK10861 Tatiana Silva'), id: '14157', url: 'u1' },
    { label: parseOrderNumber('#IE10861 Sean Murphy'),   id: '99001', url: 'u2' },
];
let r = matchOrders(collide, ['10861']);
assert.deepStrictEqual(r.found, [], 'ambiguous digits must not be guessed');
assert.strictEqual(r.ambiguous.length, 1);
assert.ok(r.ambiguous[0].includes('UK10861') && r.ambiguous[0].includes('IE10861'));
// ...but the full number stays unambiguous.
assert.deepStrictEqual(ids(matchOrders(collide, ['#IE10861'])), ['99001']);

// Unknown numbers are reported, not dropped.
r = matchOrders(rows, ['#UK10861', '#UK99999']);
assert.deepStrictEqual(ids(r), ['14157']);
assert.deepStrictEqual(r.notFound, ['#UK99999']);

// The same order pasted twice opens one tab, not two.
assert.deepStrictEqual(ids(matchOrders(rows, ['#UK10861', '10861', 'UK10861'])), ['14157']);

// Plain numeric stores (lidagreen.com) keep working.
const plain = [{ label: parseOrderNumber('#43075 Ivana Sorace'), id: '43075', url: 'u' }];
assert.deepStrictEqual(ids(matchOrders(plain, ['#43075'])), ['43075']);
assert.deepStrictEqual(ids(matchOrders(plain, ['43075'])), ['43075']);

// Junk input.
assert.deepStrictEqual(matchOrders(rows, ['', '   ', '###']).found, []);
assert.deepStrictEqual(matchOrders([], ['#UK10861']).notFound, ['#UK10861']);

console.log('order matching: 22/22 ok');
