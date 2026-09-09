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

// THE PRIMARY WORKFLOW: the shipment export column holds POST IDS, and that column
// is what gets pasted in. Matching only the displayed number missed it entirely.
assert.deepStrictEqual(ids(matchOrders(rows, ['14157', '14156'])), ['14157', '14156'],
    'post ids pasted from the export must match');

// Every form an operator can paste for the same order.
for (const form of ['#UK10861', 'UK10861', 'uk10861', ' #UK-10861 ', '10861', '14157']) {
    assert.deepStrictEqual(ids(matchOrders(rows, [form])), ['14157'], `form ${JSON.stringify(form)} must match`);
}

// The queue must carry the POST ID, never the displayed number — the order page
// identifies itself by ?post=/?id=, so queuing 10861 would never fire.
assert.deepStrictEqual(ids(matchOrders(rows, ['#UK10861', '#UK10859'])), ['14157', '14154']);

/* ── Duplicates: the script used to open the same order in two tabs ─────────── */
let r = matchOrders(rows, ['#UK10861', '14157', '10861', 'UK10861']);
assert.deepStrictEqual(ids(r), ['14157'], 'four references to one order open ONE tab');
assert.strictEqual(r.duplicates.length, 3, 'and the three skipped lines are reported');

r = matchOrders(rows, ['#UK10861', '#UK10861']);
assert.deepStrictEqual(ids(r), ['14157']);
assert.deepStrictEqual(r.duplicates, ['#UK10861']);

// A bare number that is one order's post id AND another's order number must not be
// guessed — that would create a shipment for the wrong customer.
const collide = [
    { label: 'UK10861', id: '14157', url: 'u1' },
    { label: 'UK99999', id: '10861', url: 'u2' },   // its post id == the other's digits
];
r = matchOrders(collide, ['10861']);
assert.deepStrictEqual(r.found, [], 'ambiguous reference must not be guessed');
assert.strictEqual(r.ambiguous.length, 1);
// ...but an unambiguous reference to either still works.
assert.deepStrictEqual(ids(matchOrders(collide, ['UK10861'])), ['14157']);
assert.deepStrictEqual(ids(matchOrders(collide, ['14157'])), ['14157']);
assert.deepStrictEqual(ids(matchOrders(collide, ['UK99999'])), ['10861']);

// Unknown numbers are reported, not dropped.
r = matchOrders(rows, ['#UK10861', '#UK99999']);
assert.deepStrictEqual(ids(r), ['14157']);
assert.deepStrictEqual(r.notFound, ['#UK99999']);

// Plain numeric stores (lidagreen.com) keep working.
const plain = [{ label: parseOrderNumber('#43075 Ivana Sorace'), id: '43075', url: 'u' }];
assert.deepStrictEqual(ids(matchOrders(plain, ['#43075'])), ['43075']);
assert.deepStrictEqual(ids(matchOrders(plain, ['43075'])), ['43075']);

// Junk input.
assert.deepStrictEqual(matchOrders(rows, ['', '   ', '###']).found, []);
assert.deepStrictEqual(matchOrders([], ['#UK10861']).notFound, ['#UK10861']);

console.log('order matching: 30/30 ok');
