"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESOLVED = exports.arrStartsWith = exports.waitForEvent = exports.resolveOnEvent = exports.streamToArray = exports.ensureAbstractLevel = exports.isAbstractLevel = exports.isObject = void 0;
const isObject = (o) => {
    return typeof (o) === 'object' && o !== null;
};
exports.isObject = isObject;
const isAbstractLevel = (o) => {
    return (0, exports.isObject)(o)
        && typeof (o.open) === 'function'
        && typeof (o.batch) === 'function';
};
exports.isAbstractLevel = isAbstractLevel;
const ensureAbstractLevel = (o, key) => {
    if (!(0, exports.isAbstractLevel)(o)) {
        throw new Error(`${key} is not an AbstractLevel instance`);
    }
};
exports.ensureAbstractLevel = ensureAbstractLevel;
const streamToArray = (readStream) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const onData = (chunk) => {
            chunks.push(chunk);
        };
        const cleanup = () => {
            readStream.removeListener('data', onData);
            readStream.removeListener('error', onError);
            readStream.destroy();
        };
        const onEnd = () => {
            cleanup();
            resolve(chunks);
        };
        const onError = (err) => {
            cleanup();
            reject(err);
        };
        readStream.on('error', onError);
        readStream.on('end', onEnd);
        readStream.on('data', onData);
    });
};
exports.streamToArray = streamToArray;
const resolveOnEvent = (emitter, event, rejectOnError) => {
    return new Promise((resolve, reject) => {
        const onceEvent = (arg) => {
            emitter.removeListener('error', onceError);
            resolve(arg);
        };
        const onceError = (err) => {
            emitter.removeListener(event, onceEvent);
            reject(err);
        };
        emitter.once(event, onceEvent);
        if (rejectOnError) {
            emitter.once('error', onceError);
        }
    });
};
exports.resolveOnEvent = resolveOnEvent;
exports.waitForEvent = exports.resolveOnEvent;
const arrStartsWith = (arr, prefix) => {
    for (let i = 0; i < prefix.length; i += 1) {
        if (prefix[i] !== arr[i]) {
            return false;
        }
    }
    return true;
};
exports.arrStartsWith = arrStartsWith;
exports.RESOLVED = Promise.resolve();
//# sourceMappingURL=stuff.js.map