"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeInBatches = void 0;
const consumeInBatches = async (readable, batchSize, onEachBatch) => {
    return new Promise((resolve, reject) => {
        let bufpos = 0;
        let looping = false;
        let ended = false;
        let buffer = new Array(batchSize);
        const flushAndResolve = () => {
            cleanup();
            if (bufpos > 0) {
                Promise.resolve(onEachBatch(buffer.slice(0, bufpos)))
                    .then(resolve)
                    .catch(onError);
                return;
            }
            resolve();
        };
        const onEnd = () => {
            ended = true;
            if (!looping) {
                flushAndResolve();
            }
        };
        const onError = (err) => {
            cleanup();
            reject(err);
        };
        const onReadable = () => {
            if (!looping) {
                loop();
            }
        };
        let item = null;
        const loop = () => {
            looping = true;
            if (ended) {
                flushAndResolve();
                return;
            }
            while (bufpos < batchSize && (item = readable.read()) !== null) {
                buffer[bufpos++] = item;
            }
            if (item === null) {
                looping = false;
                return;
            }
            if (bufpos === batchSize) {
                Promise.resolve(onEachBatch(buffer.slice()))
                    .then(loop)
                    .catch(onError);
                bufpos = 0;
            }
        };
        const cleanup = () => {
            readable.removeListener('end', onEnd);
            readable.removeListener('error', onError);
            readable.removeListener('readable', onReadable);
            if (typeof readable.destroy === 'function') {
                readable.destroy();
            }
        };
        readable.on('end', onEnd);
        readable.on('error', onError);
        readable.on('readable', onReadable);
        if (readable.readable !== false) {
            loop();
        }
    });
};
exports.consumeInBatches = consumeInBatches;
//# sourceMappingURL=consumeinbatches.js.map