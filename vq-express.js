import express from 'express';
import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import { extractVars, getRevealedQuads, identifyCreds, streamToArray } from './utils.js';
// source documents
import creds from './sample/people_namedgraph_bnodes.json' assert { type: 'json' };
// JSON-LD context
import vcv1 from './context/vcv1.json' assert { type: 'json' };
import zkpld from './context/bbs-termwise-2021.json' assert { type: 'json' };
import schemaorg from './context/schemaorg.json' assert { type: 'json' };
const PROOF = 'https://w3id.org/security#proof';
const URL_TO_CONTEXTS = new Map([
    ['https://www.w3.org/2018/credentials/v1', vcv1],
    ['https://zkp-ld.org/bbs-termwise-2021.jsonld', zkpld],
    ['https://schema.org', schemaorg],
]);
const CONTEXTS = [...URL_TO_CONTEXTS.keys()]; // TBD
const customDocLoader = (url) => {
    const context = URL_TO_CONTEXTS.get(url);
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
const quads = await jsonld.toRDF(creds, { documentLoader: customDocLoader });
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
    // extract variables from SELECT query
    const vars = extractVars(query);
    if (vars == undefined) {
        return next(new Error('SPARQL query must be SELECT form'));
    }
    // identify target credentials based on BGP
    const credGraphIriToBgpTriples = await identifyCreds(query, df, engine);
    if (credGraphIriToBgpTriples == undefined) {
        return next(new Error('SPARQL query must be SELECT form')); // TBD
    }
    console.log(credGraphIriToBgpTriples);
    // get original credentials
    const credsArray = [];
    for (const credGraphIriToBgpTriple of credGraphIriToBgpTriples) {
        const creds = [];
        for (const credGraphIri of credGraphIriToBgpTriple.keys()) {
            // get whole document (without proof)
            const { items: docWithGraphIri } = await store.get({ graph: df.namedNode(credGraphIri) });
            const doc = docWithGraphIri.map((quad) => df.quad(quad.subject, quad.predicate, quad.object)); // remove graph name
            // get proofs
            const { items: proofIdQuads } = await store.get({ predicate: df.namedNode(PROOF), graph: df.namedNode(credGraphIri) });
            const proofs = [];
            for (const proofId of proofIdQuads.map((proofIdQuad) => proofIdQuad.object.value)) {
                const { items: proofQuads } = await store.get({ graph: df.blankNode(proofId) });
                proofs.push(proofQuads);
            }
            creds.push({
                doc, proofs
            });
        }
        ;
        credsArray.push(creds);
    }
    ;
    // get revealed credentials
    const revealedCredsArray = [];
    for (const credGraphIriToBgpTriple of credGraphIriToBgpTriples) {
        const creds = [];
        for (const [revealedCredGraphIri, bgpTriples] of credGraphIriToBgpTriple.entries()) {
            // get whole document (without proof)
            const doc = await getRevealedQuads(revealedCredGraphIri, bgpTriples, query, df, engine);
            if (doc == undefined) {
                return next(new Error('SPARQL query must be SELECT form')); // TBD
            }
            // TBD: get proofs
            const proofs = [];
            creds.push({
                doc, proofs
            });
        }
        ;
        revealedCredsArray.push(creds);
    }
    console.dir(revealedCredsArray, { depth: 8 });
    // serialize credentials
    const credJsons = [];
    for (const creds of revealedCredsArray) {
        if (creds == null) {
            return next(new Error('internal error')); // TBD
        }
        for (const cred of creds) {
            const credJson = await jsonld.fromRDF(cred.doc.concat(cred.proofs.flat()));
            const credJsonCompact = await jsonld.compact(credJson, CONTEXTS, { documentLoader: customDocLoader });
            credJsons.push(credJsonCompact);
        }
    }
    // add VP (or VCs) to bindings
    const bindingsWithVPArray = bindingsArray.map((bindings, i) => bindings.set('vp', df.literal(JSON.stringify(credJsons[i]), df.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON'))));
    const isNotNullOrUndefined = (v) => null != v;
    let jsonVars;
    if (vars.length === 1 && 'value' in vars[0] && vars[0].value === '*') {
        // SELECT * WHERE {...}
        jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
    }
    else {
        // SELECT ?s ?p ?o WHERE {...} / SELECT (?s AS ?sub) ?p ?o WHERE {...}
        jsonVars = vars.map((v) => 'value' in v ? v.value : v.variable.value);
    }
    jsonVars.push('vp');
    const jsonBindingsArray = [];
    for (const bindings of bindingsWithVPArray) {
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
    // run rdf-signatures-bbs to get derived proofs
    // attach derived proofs
});
