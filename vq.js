import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import sparqljs from 'sparqljs';
// Constants
const GRAPH_PATTERN_PREFIX = 'ggggg'; // TBD
// SPARQL queries
import { selectQuery } from './queries/query_vq.js';
// source documents
import source from './sample/people_namedgraph_bnodes.json' assert { type: 'json' };
// JSON-LD context
import vcv1 from './context/vcv1.json' assert { type: 'json' };
import zkpld from './context/bbs-termwise-2021.json' assert { type: 'json' };
import schemaorg from './context/schemaorg.json' assert { type: 'json' };
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
// setup quadstore
const backend = new MemoryLevel();
const df = new DataFactory();
const store = new Quadstore({ backend, dataFactory: df });
const engine = new Engine(store);
await store.open();
// store JSON-LD documents
const scope = await store.initScope(); // for preventing blank node collisions
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
await store.multiPut(quads, { scope });
// // for debug
// const nquads = await jsonld.canonize(source, { format: 'application/n-quads', documentLoader: customDocLoader });
// console.log('\n[nquads]', nquads);
// const getResult = await store.get({});
// console.log('\n[getResult]', getResult.items);
// execute select queries
const bindingsStream = await engine.queryBindings(selectQuery, { unionDefaultGraph: true });
const bindings = await streamToArray(bindingsStream);
console.log('\n[query]', selectQuery);
console.dir(bindings, { depth: null });
if (bindings.length === 0) {
    console.error('SELECT query matches nothing');
}
;
// identify graphs
const identifyGraphs = async (selectQuery) => {
    var _a, _b;
    // parse original query
    const parser = new sparqljs.Parser();
    const parsedQuery = parser.parse(selectQuery);
    console.dir(parsedQuery, { depth: null });
    if (parsedQuery.queryType !== 'SELECT') {
        console.error('Query must be SELECT query');
    }
    const bgpPattern = (_a = parsedQuery.where) === null || _a === void 0 ? void 0 : _a.filter((p) => p.type === 'bgp')[0];
    const graphPatterns = bgpPattern.triples.map((t, i) => {
        const patterns = [
            {
                type: 'bgp',
                triples: [t]
            }
        ];
        const name = df.variable(`${GRAPH_PATTERN_PREFIX}${i}`);
        return {
            type: 'graph',
            patterns,
            name
        };
    });
    parsedQuery.variables = [...Array(graphPatterns.length)].map((_, i) => df.variable(`${GRAPH_PATTERN_PREFIX}${i}`));
    parsedQuery.where = (_b = parsedQuery.where) === null || _b === void 0 ? void 0 : _b.concat(graphPatterns);
    console.dir(parsedQuery, { depth: null });
    // generate query to identify named graphs
    const generator = new sparqljs.Generator();
    const generatedQuery = generator.stringify(parsedQuery);
    console.log(generatedQuery);
    const bindingsStream = await engine.queryBindings(generatedQuery, { unionDefaultGraph: true });
    const bindings = await streamToArray(bindingsStream);
    return bindings;
};
const graphs = await identifyGraphs(selectQuery);
console.dir(graphs, { depth: null });
