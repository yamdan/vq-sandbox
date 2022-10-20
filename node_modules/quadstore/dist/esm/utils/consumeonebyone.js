export const consumeOneByOne = async (iterator, onEachItem) => {
    return new Promise((resolve, reject) => {
        let item;
        let ended = false;
        let looping = false;
        const loop = () => {
            looping = true;
            if ((item = iterator.read()) !== null) {
                Promise.resolve(onEachItem(item))
                    .then(loop)
                    .catch(onError);
                return;
            }
            looping = false;
            if (ended) {
                resolve();
            }
        };
        const onError = (err) => {
            reject(err);
            cleanup();
        };
        const onEnd = () => {
            ended = true;
            if (!looping) {
                resolve();
            }
            cleanup();
        };
        const onReadable = () => {
            if (!looping) {
                loop();
            }
        };
        const cleanup = () => {
            iterator.removeListener('end', onEnd);
            iterator.removeListener('error', onError);
            iterator.removeListener('readable', onReadable);
            if (typeof iterator.destroy === 'function') {
                iterator.destroy();
            }
        };
        iterator.on('end', onEnd);
        iterator.on('error', onError);
        iterator.on('readable', onReadable);
        if (iterator.readable !== false) {
            loop();
        }
    });
};
//# sourceMappingURL=consumeonebyone.js.map