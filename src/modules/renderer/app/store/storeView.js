import { FLAT_STATE_PROPERTY_PATHS, SLICE_NAMES } from './appStore.js';

const ARRAY_MUTATION_METHODS = new Set([
    'copyWithin',
    'fill',
    'pop',
    'push',
    'reverse',
    'shift',
    'sort',
    'splice',
    'unshift',
]);

function getPathValue(target, path = []) {
    return path.reduce((value, key) => value?.[key], target);
}

function clonePathContainer(value) {
    if (Array.isArray(value)) {
        return value.slice();
    }

    if (value && typeof value === 'object') {
        return { ...value };
    }

    return {};
}

function cloneSliceAtPath(sliceState, path = []) {
    const nextSlice = clonePathContainer(sliceState);
    if (path.length === 0) {
        return nextSlice;
    }

    let sourceCursor = sliceState;
    let nextCursor = nextSlice;

    for (let index = 0; index < path.length - 1; index += 1) {
        const key = path[index];
        const nextBranch = clonePathContainer(sourceCursor?.[key]);
        nextCursor[key] = nextBranch;
        sourceCursor = sourceCursor?.[key];
        nextCursor = nextBranch;
    }

    return nextSlice;
}

function setSlicePathValue(sliceState, path, value) {
    if (path.length === 0) {
        return value;
    }

    const nextSlice = cloneSliceAtPath(sliceState, path);
    let cursor = nextSlice;
    for (let index = 0; index < path.length - 1; index += 1) {
        cursor = cursor[path[index]];
    }
    cursor[path[path.length - 1]] = value;
    return nextSlice;
}

function deleteSlicePathValue(sliceState, path) {
    if (path.length === 0) {
        return sliceState;
    }

    const nextSlice = cloneSliceAtPath(sliceState, path);
    let cursor = nextSlice;
    for (let index = 0; index < path.length - 1; index += 1) {
        cursor = cursor[path[index]];
    }

    if (Array.isArray(cursor)) {
        cursor.splice(Number(path[path.length - 1]), 1);
    } else {
        delete cursor[path[path.length - 1]];
    }

    return nextSlice;
}

function isWritableSlice(slice, writableSlices) {
    return writableSlices === 'all' || writableSlices.has(slice);
}

function unwrapStoreValue(value, seen = new WeakMap()) {
    if (!value || typeof value !== 'object') {
        return value;
    }

    if (typeof value.__rawValue__ === 'function') {
        return unwrapStoreValue(value.__rawValue__(), seen);
    }

    if (seen.has(value)) {
        return seen.get(value);
    }

    if (Array.isArray(value)) {
        const nextArray = [];
        seen.set(value, nextArray);
        value.forEach((item, index) => {
            nextArray[index] = unwrapStoreValue(item, seen);
        });
        return nextArray;
    }

    const nextObject = {};
    seen.set(value, nextObject);
    Object.keys(value).forEach((key) => {
        nextObject[key] = unwrapStoreValue(value[key], seen);
    });
    return nextObject;
}

function createStoreView(store, options = {}) {
    const writableSlices = options.writableSlices === 'all'
        ? 'all'
        : new Set(options.writableSlices || []);

    function ensureWritable(slice, propLabel) {
        if (!isWritableSlice(slice, writableSlices)) {
            throw new Error(`Cannot mutate ${String(propLabel)} outside writable slices: ${slice}`);
        }
    }

    function createPathProxy(slice, path = []) {
        let proxy = null;

        function currentValue() {
            return getPathValue(store.getState()[slice], path);
        }

        const target = Array.isArray(currentValue()) ? [] : {};
        proxy = new Proxy(target, {
            get(_target, prop) {
                if (prop === '__slice__') {
                    return slice;
                }
                if (prop === '__path__') {
                    return path.slice();
                }
                if (prop === Symbol.toPrimitive) {
                    return () => currentValue();
                }
                if (prop === 'valueOf') {
                    return () => currentValue();
                }
                if (prop === 'toJSON') {
                    return () => currentValue();
                }
                if (prop === '__rawValue__') {
                    return () => currentValue();
                }

                const value = currentValue();
                if (value == null) {
                    return value?.[prop];
                }

                if (Array.isArray(value)) {
                    if (prop === Symbol.iterator) {
                        return function* iterator() {
                            for (let index = 0; index < value.length; index += 1) {
                                yield proxy[index];
                            }
                        };
                    }

                    if (typeof prop === 'string' && ARRAY_MUTATION_METHODS.has(prop)) {
                        return (...args) => {
                            ensureWritable(slice, prop);
                            let result;
                            store.patchState(slice, (currentSlice) => {
                                const nextSlice = clonePathContainer(currentSlice);
                                const parentPath = path.slice(0, -1);
                                const key = path[path.length - 1];
                                const container = parentPath.length === 0
                                    ? nextSlice
                                    : cloneSliceAtPath(currentSlice, path);
                                const arrayTarget = path.length === 0
                                    ? container
                                    : getPathValue(container, path);
                                result = Array.prototype[prop].apply(arrayTarget, args.map((arg) => unwrapStoreValue(arg)));
                                return container;
                            });
                            return result;
                        };
                    }

                    const propertyValue = value[prop];
                    if (typeof propertyValue === 'function') {
                        return (...args) => Array.prototype[prop].apply(proxy, args);
                    }
                }

                const propertyValue = value[prop];
                if (propertyValue && typeof propertyValue === 'object') {
                    return createPathProxy(slice, path.concat(prop));
                }

                return propertyValue;
            },
            set(_target, prop, value) {
                ensureWritable(slice, prop);
                store.patchState(slice, (currentSlice) => setSlicePathValue(currentSlice, path.concat(prop), unwrapStoreValue(value)));
                return true;
            },
            deleteProperty(_target, prop) {
                ensureWritable(slice, prop);
                store.patchState(slice, (currentSlice) => deleteSlicePathValue(currentSlice, path.concat(prop)));
                return true;
            },
            ownKeys() {
                const value = currentValue();
                if (!value || typeof value !== 'object') {
                    return [];
                }
                return Reflect.ownKeys(value);
            },
            has(_target, prop) {
                const value = currentValue();
                return value != null && prop in value;
            },
            getOwnPropertyDescriptor(_target, prop) {
                const value = currentValue();
                if (!value || typeof value !== 'object') {
                    return undefined;
                }

                const descriptor = Object.getOwnPropertyDescriptor(value, prop);
                if (descriptor) {
                    return {
                        ...descriptor,
                        configurable: true,
                    };
                }

                if (prop in value) {
                    return {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: value[prop],
                    };
                }

                return undefined;
            },
        });

        return proxy;
    }

    return new Proxy({}, {
        get(_target, prop) {
            if (prop === '__raw__') {
                return store.getState();
            }
            if (prop === 'getState') {
                return store.getState;
            }

            const mapping = FLAT_STATE_PROPERTY_PATHS[prop];
            if (!mapping) {
                return undefined;
            }

            const [slice, ...path] = mapping;
            const value = getPathValue(store.getState()[slice], path);
            if (value && typeof value === 'object') {
                return createPathProxy(slice, path);
            }
            return value;
        },
        set(_target, prop, value) {
            const mapping = FLAT_STATE_PROPERTY_PATHS[prop];
            if (!mapping) {
                throw new Error(`Unknown app state property: ${String(prop)}`);
            }

            const [slice, ...path] = mapping;
            ensureWritable(slice, prop);
            store.patchState(slice, (currentSlice) => setSlicePathValue(currentSlice, path, unwrapStoreValue(value)));
            return true;
        },
        ownKeys() {
            return Reflect.ownKeys(FLAT_STATE_PROPERTY_PATHS);
        },
        has(_target, prop) {
            return prop in FLAT_STATE_PROPERTY_PATHS;
        },
        getOwnPropertyDescriptor(_target, prop) {
            if (!(prop in FLAT_STATE_PROPERTY_PATHS)) {
                return undefined;
            }
            return {
                configurable: true,
                enumerable: true,
                writable: isWritableSlice(FLAT_STATE_PROPERTY_PATHS[prop][0], writableSlices),
                value: undefined,
            };
        },
    });
}

const RENDERER_WRITABLE_SLICES = Object.freeze([...SLICE_NAMES]);

export {
    RENDERER_WRITABLE_SLICES,
    createStoreView,
};
