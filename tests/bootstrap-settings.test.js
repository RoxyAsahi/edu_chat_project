const test = require('node:test');
const assert = require('assert/strict');

const {
    isTruthyFlag,
    shouldSeedDefaultDataRoot,
} = require('../src/modules/main/utils/bootstrapSettings');

test('isTruthyFlag recognizes supported truthy values', () => {
    assert.equal(isTruthyFlag('1'), true);
    assert.equal(isTruthyFlag(' true '), true);
    assert.equal(isTruthyFlag('YES'), true);
    assert.equal(isTruthyFlag('on'), true);
    assert.equal(isTruthyFlag('0'), false);
    assert.equal(isTruthyFlag('false'), false);
    assert.equal(isTruthyFlag(''), false);
});

test('shouldSeedDefaultDataRoot defaults to seeding unless explicitly disabled', () => {
    assert.equal(shouldSeedDefaultDataRoot({}), true);
    assert.equal(shouldSeedDefaultDataRoot({ UNISTUDY_SKIP_DEFAULT_SEED: '0' }), true);
    assert.equal(shouldSeedDefaultDataRoot({ UNISTUDY_SKIP_DEFAULT_SEED: '1' }), false);
    assert.equal(shouldSeedDefaultDataRoot({ UNISTUDY_SKIP_DEFAULT_SEED: 'true' }), false);
});
