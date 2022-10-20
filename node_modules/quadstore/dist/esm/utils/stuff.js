export const isObject = (o) => {
    return typeof (o) === 'object' && o !== null;
};
export const isAbstractLevel = (o) => {
    return isObject(o)
        && typeof (o.open) === 'function'
        && typeof (o.batch) === 'function';
};
export const ensureAbstractLevel = (o, key) => {
    if (!isAbstractLevel(o)) {
        throw new Error(`${key} is not an AbstractLevel instance`);
    }
};
export const streamToArray = (readStream) => {
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
export const resolveOnEvent = (emitter, event, rejectOnError) => {
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
export const waitForEvent = resolveOnEvent;
export const arrStartsWith = (arr, prefix) => {
    for (let i = 0; i < prefix.length; i += 1) {
        if (prefix[i] !== arr[i]) {
            return false;
        }
    }
    return true;
};
export const RESOLVED = Promise.resolve();
//# sourceMappingURL=stuff.js.map