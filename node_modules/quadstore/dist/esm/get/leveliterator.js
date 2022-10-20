import { BufferedIterator } from 'asynciterator';
export class LevelIterator extends BufferedIterator {
    level;
    mapFn;
    levelEnded;
    constructor(levelIterator, mapper) {
        super({ maxBufferSize: 64 });
        this.mapFn = mapper;
        this.level = levelIterator;
        this.levelEnded = false;
    }
    _read(qty, done) {
        const state = { remaining: qty };
        state.next = this._onNextValue.bind(this, state, done);
        this.level.next(state.next);
    }
    _onNextValue(state, done, err, key, value) {
        if (err) {
            done(err);
            return;
        }
        if (key === undefined && value === undefined) {
            this.close();
            this.levelEnded = true;
            done();
            return;
        }
        this._push(this.mapFn(key, value));
        state.remaining -= 1;
        if (state.remaining === 0) {
            done();
            return;
        }
        this.level.next(state.next);
    }
    ;
    _endLevel(cb) {
        if (this.levelEnded) {
            cb();
            return;
        }
        this.level.close((err) => {
            if (!err) {
                this.levelEnded = true;
            }
            cb(err);
        });
    }
    _end(destroy) {
        if (this.ended) {
            return;
        }
        super._end(destroy);
        this._endLevel((endErr) => {
            if (endErr) {
                this.emit('error', endErr);
            }
        });
    }
    _destroy(cause, cb) {
        if (this.destroyed) {
            cb();
            return;
        }
        this._endLevel((endErr) => {
            if (endErr) {
                cb(endErr);
                return;
            }
            super._destroy(cause, cb);
        });
    }
}
//# sourceMappingURL=leveliterator.js.map