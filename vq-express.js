import express from 'express';
import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import { identifyGraphs, streamToArray } from './utils.js';
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
// setup quadstore
const backend = new MemoryLevel();
const df = new DataFactory();
const store = new Quadstore({ backend, dataFactory: df });
const engine = new Engine(store);
await store.open();
// store initial documents
const scope = await store.initScope(); // for preventing blank node collisions
const quads = await jsonld.toRDF(source, { documentLoader: customDocLoader });
await store.multiPut(quads, { scope });
// setup express server
const app = express();
const port = 3000;
app.disable('x-powered-by');
app.use(express.urlencoded());
app.listen(port, () => {
    console.log('vq-express: started on port 3000');
});
// SPARQL endpoint
app.get('/sparql/', async (req, res, next) => {
    // get query string
    const query = req.query.query;
    if (typeof query !== 'string') {
        return next(new Error('SPARQL query must be given as `query` parameter'));
    }
    // parse query
    const parsedQuery = await engine.query(query, { unionDefaultGraph: true });
    if (parsedQuery.resultType !== 'bindings') {
        return next(new Error('SPARQL query must be SELECT form'));
    }
    // execute SELECT queries
    const bindingsStream = await parsedQuery.execute();
    const bindings = await streamToArray(bindingsStream);
    if (bindings.length === 0) {
        return next(new Error('SELECT query matches nothing'));
    }
    ;
    // identify target graphs based on BGP
    const graphToTriples = await identifyGraphs(query, df, engine);
    console.dir(graphToTriples, { depth: null });
    // get graphs
    const credsArray = [];
    for (const graphToTriple of graphToTriples) {
        const creds = [];
        for (const graphIRI of graphToTriple.keys()) {
            const { items } = await store.get({ graph: df.namedNode(graphIRI) });
            creds.push(items);
        }
        ;
        credsArray.push(creds);
    }
    ;
    console.dir(credsArray[0], { depth: null });
    // send response
    res.send({
        'query': `${query}`,
        'creds': credsArray,
    });
    // TBD: get associated proofs
    // get revealed quads
    // run rdf-signatures-bbs to get derived proofs
    // attach derived proofs
});
