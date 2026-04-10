const { bootstrapPreload } = require('./shared/bootstrap');
const { ROLE_API_NAMES, VIEWER_KEYS } = require('./shared/roles');

try {
    bootstrapPreload({
        apiName: ROLE_API_NAMES.viewer,
        allowedKeys: VIEWER_KEYS,
    });
    console.log('[Preload][viewer] loaded via shared bootstrap');
} catch (error) {
    console.error('[Preload][viewer] failed to initialize:', error);
    throw error;
}
