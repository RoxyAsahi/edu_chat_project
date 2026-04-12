const { createShellCatalog } = require('./catalogShell');
const { createSessionCatalog } = require('./catalogSession');
const { createContentCatalog } = require('./catalogContent');

function createCatalog(ops) {
    return {
        ...createShellCatalog(ops),
        ...createSessionCatalog(ops),
        ...createContentCatalog(ops),
    };
}

module.exports = {
    createCatalog,
    createShellCatalog,
    createSessionCatalog,
    createContentCatalog,
};
