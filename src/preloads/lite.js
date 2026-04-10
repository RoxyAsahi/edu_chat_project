const { bootstrapPreload } = require('./shared/bootstrap');
const { LITE_KEYS, ROLE_API_NAMES } = require('./shared/roles');

try {
    bootstrapPreload({
        apiName: ROLE_API_NAMES.lite,
        allowedKeys: LITE_KEYS,
    });
    console.log('[Preload][lite] loaded via shared bootstrap');
} catch (error) {
    console.error('[Preload][lite] failed to initialize:', error);
    throw error;
}
