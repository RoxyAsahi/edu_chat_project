const {
    createOps,
    materializeApi,
    createCompatApi,
    exposeRoleApis,
} = require('./shared/apiFactory');
const { createCatalog } = require('./shared/catalog');
const { VIEWER_KEYS } = require('./shared/roles');

const ops = createOps();
const definitions = createCatalog(ops);
const roleApi = materializeApi(definitions, VIEWER_KEYS);
const compatApi = createCompatApi(definitions, VIEWER_KEYS);

exposeRoleApis('utilityAPI', roleApi, compatApi, ops);

console.log('[Preload][viewer] loaded');
