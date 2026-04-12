function normalizeErrorMessage(error, fallback = 'Unknown error') {
    if (typeof error === 'string' && error.trim() !== '') {
        return error;
    }

    if (error && typeof error.message === 'string' && error.message.trim() !== '') {
        return error.message;
    }

    return fallback;
}

function ok(payload = {}) {
    return {
        success: true,
        ...payload,
    };
}

function fail(error, payload = {}, fallbackMessage) {
    return {
        success: false,
        error: normalizeErrorMessage(error, fallbackMessage),
        ...payload,
    };
}

module.exports = {
    ok,
    fail,
    normalizeErrorMessage,
};
