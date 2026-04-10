const {
    createOps,
    createCompatApi,
    exposeRoleApis,
    materializeApi,
} = require('./apiFactory');
const { createCatalog } = require('./catalog');

function bootstrapPreload({ apiName, allowedKeys }) {
    if (typeof apiName !== 'string' || apiName.trim() === '') {
        throw new Error('[PreloadBootstrap] apiName must be a non-empty string.');
    }

    if (!Array.isArray(allowedKeys)) {
        throw new Error('[PreloadBootstrap] allowedKeys must be an array.');
    }

    const ops = createOps();
    const definitions = createCatalog(ops);
    const roleApi = materializeApi(definitions, allowedKeys);
    const compatApi = createCompatApi(definitions, allowedKeys);
    exposeRoleApis(apiName, roleApi, compatApi, ops);
}

module.exports = {
    bootstrapPreload,
};
