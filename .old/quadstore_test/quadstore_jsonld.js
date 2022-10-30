import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
// SPARQL queries
import queries from '../../queries/query3.js';
// source documents
import source from '../../sample/people_namedgraph_bnodes.json' assert { type: 'json' };
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
// load JSON-LD credentials into quadstore
const quads = await jsonld.toRDF(source, { documentLoader: customDocLoader });
// remove blank node ids' prefixes `_:`
// quads.forEach((quad) => {
//   for (const target of [quad.subject, quad.object, quad.graph]) {
//     if (target.termType === 'BlankNode'
//       && target.value.startsWith('_:')) {
//       target.value = target.value.substring(2);
//     };
//   }
// });
//console.log('\n[quads]', quads);
await store.multiPut(quads, { scope });
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
        // // canonicalize into dataset with issuer
        // const { dataset, issuer } = await canonize.canonize(quadArray, { algorithm: 'URDNA2015+' });
        // console.log('\n[dataset] ', dataset);
        // console.log('\n[issuer] ', issuer);
    }
    else if (result.resultType === 'boolean') {
        const askResult = await result.execute();
        console.log('\n[query]', q);
        console.log('[result]\n', askResult);
    }
});
const getResult = await store.get({});
console.log('\n[getResult]', getResult.items);
