"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scope = void 0;
const leveliterator_1 = require("../get/leveliterator");
const consumeonebyone_1 = require("../utils/consumeonebyone");
const uid_1 = require("../utils/uid");
const constants_1 = require("../utils/constants");
class Scope {
    id;
    blankNodes;
    factory;
    static async init(store) {
        return new Scope(store.dataFactory, (0, uid_1.uid)(), new Map());
    }
    static async load(store, scopeId) {
        const levelOpts = Scope.getLevelIteratorOpts(false, true, scopeId);
        const iterator = new leveliterator_1.LevelIterator(store.db.iterator(levelOpts), (key, value) => value);
        const blankNodes = new Map();
        const { dataFactory: factory } = store;
        await (0, consumeonebyone_1.consumeOneByOne)(iterator, (value) => {
            const { originalLabel, randomLabel } = JSON.parse(value);
            blankNodes.set(originalLabel, factory.blankNode(randomLabel));
        });
        return new Scope(factory, scopeId, blankNodes);
    }
    static async delete(store, scopeId) {
        const batch = store.db.batch();
        const levelOpts = Scope.getLevelIteratorOpts(true, false, scopeId);
        const iterator = new leveliterator_1.LevelIterator(store.db.iterator(levelOpts), (key, value) => key);
        await (0, consumeonebyone_1.consumeOneByOne)(iterator, (key) => {
            batch.del(key);
        });
        await batch.write();
    }
    static getLevelIteratorOpts(keys, values, scopeId) {
        const gte = scopeId
            ? `SCOPE${constants_1.separator}${scopeId}${constants_1.separator}`
            : `SCOPE${constants_1.separator}`;
        return {
            keys,
            values,
            keyEncoding: 'utf8',
            valueEncoding: 'utf8',
            gte,
            lte: `${gte}${constants_1.boundary}`,
        };
    }
    static addMappingToLevelBatch(scopeId, batch, originalLabel, randomLabel) {
        batch.put(`SCOPE${constants_1.separator}${scopeId}${constants_1.separator}${originalLabel}`, JSON.stringify({ originalLabel, randomLabel }));
    }
    constructor(factory, id, blankNodes) {
        this.blankNodes = blankNodes;
        this.factory = factory;
        this.id = id;
    }
    parseBlankNode(node, batch) {
        let cachedNode = this.blankNodes.get(node.value);
        if (!cachedNode) {
            cachedNode = this.factory.blankNode((0, uid_1.uid)());
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
exports.Scope = Scope;
//# sourceMappingURL=index.js.map