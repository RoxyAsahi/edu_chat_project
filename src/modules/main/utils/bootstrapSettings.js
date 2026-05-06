function isTruthyFlag(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1'
        || normalized === 'true'
        || normalized === 'yes'
        || normalized === 'on';
}

function shouldSeedDefaultDataRoot(env = process.env) {
    return !isTruthyFlag(env.UNISTUDY_SKIP_DEFAULT_SEED);
}

module.exports = {
    isTruthyFlag,
    shouldSeedDefaultDataRoot,
};
