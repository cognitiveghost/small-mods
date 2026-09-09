// Self-check for the Nigeria price distribution. Run: node test_nigeria.js
const assert = require('assert');
const { computePrices, LIMITS } = require('./DHL Nigeria Price Calculator-3.0.user.js');

const total = (items, prices) => prices.reduce((s, p, i) => s + p * items[i].qty, 0);
const fits = (items, r) =>
    total(items, r.prices) <= LIMITS.MAX_TOTAL + 1e-9 &&
    r.prices.every((p) => p > 0 && p <= LIMITS.MAX_PER_ITEM + 1e-9);

// 1. Already under the limit — untouched apart from the zero floor.
let it = [{ qty: 1, price: 20 }, { qty: 2, price: 10 }];
let r = computePrices(it);
assert.strictEqual(r.mode, 'cap');
assert.deepStrictEqual(r.prices, [20, 10]);

// 2. One item over 50 — capping alone is enough.
it = [{ qty: 1, price: 120 }, { qty: 1, price: 10 }];
r = computePrices(it);
assert.strictEqual(r.mode, 'cap');
assert.deepStrictEqual(r.prices, [50, 10]);
assert.ok(fits(it, r));

// 3. REGRESSION (v3.0 bug): every item is cheap but the total blows the 200 limit.
//    v3.0 computed a per-unit price and then never applied it, silently shipping a
//    460 EUR order as "done". The result must actually fit.
it = [{ qty: 10, price: 40 }, { qty: 2, price: 30 }];
r = computePrices(it);
assert.strictEqual(r.mode, 'flat', 'all-cheap-but-over-budget must flatten');
assert.ok(fits(it, r), `flat total ${total(it, r.prices)} must be <= 200`);

// 4. Mixed: cheap items kept, the expensive one absorbs the squeeze.
it = [{ qty: 1, price: 10 }, { qty: 1, price: 20 }, { qty: 5, price: 300 }];
r = computePrices(it);
assert.strictEqual(r.mode, 'smart');
assert.deepStrictEqual(r.prices.slice(0, 2), [10, 20], 'cheap items stay put');
assert.ok(fits(it, r), `smart total ${total(it, r.prices)} must be <= 200`);

// 5. Rounding must never round UP through the limit (3 x 66.67 = 200.01).
it = [{ qty: 3, price: 80 }];
r = computePrices(it);
assert.ok(total(it, r.prices) <= LIMITS.MAX_TOTAL, 'rounding must not breach the total');

// 6. Zero and missing prices are floored, not left at 0 (customs rejects 0).
it = [{ qty: 1, price: 0 }, { qty: 1, price: 5 }];
r = computePrices(it);
assert.ok(r.prices.every((p) => p >= LIMITS.MIN_PRICE));

// 7. Extreme case still resolves rather than erroring: 100 dear units flatten to 2 EUR each.
it = [{ qty: 100, price: 300 }];
r = computePrices(it);
assert.strictEqual(r.mode, 'flat');
assert.ok(fits(it, r), `100-unit order must still fit, got ${total(it, r.prices)}`);

// 8. Empty input.
assert.ok(computePrices([]).error);

console.log('nigeria price distribution: 8/8 ok');
