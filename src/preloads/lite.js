const {
    createOps,
    materializeApi,
    createCompatApi,
    exposeRoleApis,
} = require('./shared/apiFactory');
const { createCatalog } = require('./shared/catalog');
const { LITE_KEYS } = require('./shared/roles');

const ops = createOps();
const definitions = createCatalog(ops);
const roleApi = materializeApi(definitions, LITE_KEYS);
const compatApi = createCompatApi(definitions, LITE_KEYS);

exposeRoleApis('chatAPI', roleApi, compatApi, ops);

console.log('[Preload][lite] loaded');
