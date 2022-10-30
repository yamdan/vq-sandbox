import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
// SPARQL queries
import queries from './queries/person_bnodes.js';
// source documents
import source from './sample/person_bnodes.json' assert { type: 'json' };
import source2 from './sample/person_bnodes2.json' assert { type: 'json' };
// JSON-LD context
import vcv1 from '../../context/vcv1.json' assert { type: 'json' };
import zkpld from '../../context/bbs-termwise-2021.json' assert { type: 'json' };
import schemaorg from '../../context/schemaorg.json' assert { type: 'json' };
const documents = {
    'https://www.w3.org/2018/credentials/v1': vcv1,
    'https://zkp-ld.org/bbs-termwise-2021.jsonld': zkpld,
    'https://schema.org': schemaorg
};
const customDocLoader = (url) => {
    const context = documents[url];
    if (context) {
        return {
            contextUrl: null,
            document: context,
            documentUrl: url // this is the actual context URL after redirects
        };
    }
    throw new Error(`Error attempted to load document remotely, please cache '${url}'`);
};
// ref: https://github.com/belayeng/quadstore-comunica/blob/master/spec/src/utils.ts
const streamToArray = (source) => {
    return new Promise((resolve, reject) => {
        const items = [];
        source.on('data', (item) => {
            items.push(item);
        });
        source.on('end', () => {
            resolve(items);
        });
        source.on('error', (err) => {
            reject(err);
        });
    });
};
// JSON-LD to N-Quads
const backend = new MemoryLevel();
const df = new DataFactory();
const store = new Quadstore({ backend, dataFactory: df });
const engine = new Engine(store);
await store.open();
const scope = await store.initScope(); // for preventing blank node collisions
const scope2 = await store.initScope(); // for preventing blank node collisions
// load JSON-LD credentials into quadstore
const quads = await jsonld.toRDF(source, { documentLoader: customDocLoader });
const quads2 = await jsonld.toRDF(source2, { documentLoader: customDocLoader });
await store.multiPut(quads, { scope });
await store.multiPut(quads2, { scope: scope2 });
// // debug
const nquads = await jsonld.canonize(source, { format: 'application/n-quads', documentLoader: customDocLoader });
console.log('\n[nquads]', nquads);
// execute queries
queries.map(async (q) => {
    const result = await engine.query(q, { unionDefaultGraph: true });
    if (result.resultType === 'bindings') {
        const bindingsStream = await result.execute();
        bindingsStream.on('data', (bindings) => {
            console.log('\n[query]', q);
            console.log('[result]\n', bindings.toString());
        });
    }
    else if (result.resultType === 'quads') {
        const quadStream = await result.execute();
        console.log('\n[query]', q);
        const quadArray = await streamToArray(quadStream);
        console.log('\n[result]', quadArray);
    }
    else if (result.resultType === 'boolean') {
        const askResult = await result.execute();
        console.log('\n[query]', q);
        console.log('[result]\n', askResult);
    }
});
const getResult = await store.get({});
console.log('\n[getResult]', getResult.items);
