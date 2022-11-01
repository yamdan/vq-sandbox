import express from 'express';
import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import { extractVars, identifyGraphs, streamToArray } from './utils.js';
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
app.listen(port, () => {
    console.log('vq-express: started on port 3000');
});
// SPARQL endpoint for Fetch
app.get('/sparql/', async (req, res, next) => {
    // get query string
    const query = req.query.query;
    if (typeof query !== 'string') {
        return next(new Error('SPARQL query must be given as `query` parameter'));
    }
    // parse and execute SELECT query
    let parsedQuery;
    try {
        parsedQuery = await engine.query(query, { unionDefaultGraph: true });
    }
    catch (error) {
        return next(new Error(`malformed SPARQL query: ${error}`));
    }
    if (parsedQuery.resultType !== 'bindings') {
        return next(new Error('SPARQL query must be SELECT form'));
    }
    const bindingsStream = await parsedQuery.execute();
    const bindingsArray = await streamToArray(bindingsStream);
    // extract variables of SELECT query
    const vars = extractVars(query);
    if (vars == undefined) {
        return next(new Error('SPARQL query must be SELECT form'));
    }
    // identify target graphs based on BGP
    const graphToTriples = await identifyGraphs(query, df, engine);
    if (graphToTriples == undefined) {
        return next(new Error('SPARQL query must be SELECT form'));
    }
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
    const isNotNullOrUndefined = (v) => null != v;
    let jsonVars;
    if (vars.length === 1 && 'value' in vars[0] && vars[0].value === '*') {
        jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
    }
    else {
        jsonVars = vars.map((v) => 'value' in v ? v.value : v.variable.value);
    }
    console.dir(bindingsArray[0], { depth: 5 });
    console.log([...bindingsArray[0].keys()]);
    const jsonBindingsArray = [];
    for (const bindings of bindingsArray) {
        const jsonBindingsEntries = [...bindings].map(([k, v]) => {
            let value;
            if (v.termType === 'Literal') {
                if (v.language !== '') {
                    value = {
                        type: 'literal',
                        value: v.value,
                        'xml:lang': v.language
                    };
                }
                else if (v.datatype.value === 'http://www.w3.org/2001/XMLSchema#string') {
                    value = {
                        type: 'literal',
                        value: v.value
                    };
                }
                else {
                    value = {
                        type: 'literal',
                        value: v.value,
                        datatype: v.datatype.value
                    };
                }
            }
            else if (v.termType === 'NamedNode') {
                value = {
                    type: 'uri',
                    value: v.value
                };
            }
            else if (v.termType === 'BlankNode') {
                value = {
                    type: 'bnode',
                    value: v.value
                };
            }
            else {
                return undefined;
            }
            ;
            return [k.value, value];
        }).filter(isNotNullOrUndefined);
        const jsonBindings = Object.fromEntries(jsonBindingsEntries);
        jsonBindingsArray.push(jsonBindings);
    }
    const jsonResults = {
        "head": { "vars": jsonVars },
        "results": {
            "bindings": jsonBindingsArray
        }
    };
    res.send(jsonResults);
    // TBD: get associated proofs
    // get revealed quads
    // run rdf-signatures-bbs to get derived proofs
    // attach derived proofs
});
