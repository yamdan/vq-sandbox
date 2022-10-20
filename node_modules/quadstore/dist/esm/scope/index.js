import { LevelIterator } from '../get/leveliterator.js';
import { consumeOneByOne } from '../utils/consumeonebyone.js';
import { uid } from '../utils/uid.js';
import { separator, boundary } from '../utils/constants.js';
export class Scope {
    id;
    blankNodes;
    factory;
    static async init(store) {
        return new Scope(store.dataFactory, uid(), new Map());
    }
    static async load(store, scopeId) {
        const levelOpts = Scope.getLevelIteratorOpts(false, true, scopeId);
        const iterator = new LevelIterator(store.db.iterator(levelOpts), (key, value) => value);
        const blankNodes = new Map();
        const { dataFactory: factory } = store;
        await consumeOneByOne(iterator, (value) => {
            const { originalLabel, randomLabel } = JSON.parse(value);
            blankNodes.set(originalLabel, factory.blankNode(randomLabel));
        });
        return new Scope(factory, scopeId, blankNodes);
    }
    static async delete(store, scopeId) {
        const batch = store.db.batch();
        const levelOpts = Scope.getLevelIteratorOpts(true, false, scopeId);
        const iterator = new LevelIterator(store.db.iterator(levelOpts), (key, value) => key);
        await consumeOneByOne(iterator, (key) => {
            batch.del(key);
        });
        await batch.write();
    }
    static getLevelIteratorOpts(keys, values, scopeId) {
        const gte = scopeId
            ? `SCOPE${separator}${scopeId}${separator}`
            : `SCOPE${separator}`;
        return {
            keys,
            values,
            keyEncoding: 'utf8',
            valueEncoding: 'utf8',
            gte,
            lte: `${gte}${boundary}`,
        };
    }
    static addMappingToLevelBatch(scopeId, batch, originalLabel, randomLabel) {
        batch.put(`SCOPE${separator}${scopeId}${separator}${originalLabel}`, JSON.stringify({ originalLabel, randomLabel }));
    }
    constructor(factory, id, blankNodes) {
        this.blankNodes = blankNodes;
        this.factory = factory;
        this.id = id;
    }
    parseBlankNode(node, batch) {
        let cachedNode = this.blankNodes.get(node.value);
        if (!cachedNode) {
            cachedNode = this.factory.blankNode(uid());
            this.blankNodes.set(node.value, cachedNode);
            Scope.addMappingToLevelBatch(this.id, batch, node.value, cachedNode.value);
        }
        return cachedNode;
    }
    parseSubject(node, batch) {
        switch (node.termType) {
            case 'BlankNode':
                return this.parseBlankNode(node, batch);
            default:
                return node;
        }
    }
    parseObject(node, batch) {
        switch (node.termType) {
            case 'BlankNode':
                return this.parseBlankNode(node, batch);
            default:
                return node;
        }
    }
    parseGraph(node, batch) {
        switch (node.termType) {
            case 'BlankNode':
                return this.parseBlankNode(node, batch);
            default:
                return node;
        }
    }
    parseQuad(quad, batch) {
        return this.factory.quad(this.parseSubject(quad.subject, batch), quad.predicate, this.parseObject(quad.object, batch), this.parseGraph(quad.graph, batch));
    }
}
//# sourceMappingURL=index.js.map