import express from 'express';
import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import { Anonymizer, extractVars, genGraphPatterns, genJsonResults, getExtendedBindings, getRevealedQuads, identifyCreds, isWildcard, parseQuery, streamToArray } from './utils.js';
// source documents
import creds from './sample/people_namedgraph_bnodes.json' assert { type: 'json' };
// built-in JSON-LD contexts
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
    console.log('started on port 3000');
});
const respondToSelectQuery = async (query, parsedQuery) => {
    const bindingsStream = await parsedQuery.execute();
    const bindingsArray = await streamToArray(bindingsStream);
    // extract variables from SELECT query
    const vars = extractVars(query);
    if (vars == undefined) {
        throw new Error('SPARQL query must be SELECT form');
    }
    // send response
    let jsonVars;
    if (vars.length === 1 && 'value' in vars[0] && vars[0].value === '*') {
        // SELECT * WHERE {...}
        jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
    }
    else {
        // SELECT ?s ?p ?o WHERE {...} / SELECT (?s AS ?sub) ?p ?o WHERE {...}
        jsonVars = vars.map((v) => 'value' in v ? v.value : v.variable.value);
    }
    return { jsonVars, bindingsArray };
};
const respondToConstructQuery = async (parsedQuery) => {
    const quadsStream = await parsedQuery.execute();
    const quadsArray = await streamToArray(quadsStream);
    const quadsJsonld = await jsonld.fromRDF(quadsArray);
    const quadsJsonldCompact = await jsonld.compact(quadsJsonld, CONTEXTS, { documentLoader: customDocLoader });
    return quadsJsonldCompact;
};
// plain SPARQL endpoint
app.get('/sparql/', async (req, res, next) => {
    // get query string
    const query = req.query.query;
    if (typeof query !== 'string') {
        return next(new Error('SPARQL query must be given as `query` parameter'));
    }
    // parse query
    let parsedQuery;
    try {
        parsedQuery = await engine.query(query, { unionDefaultGraph: true });
    }
    catch (error) {
        return next(new Error(`malformed SPARQL query: ${error}`));
    }
    // execute query
    if (parsedQuery.resultType === 'bindings') {
        const { jsonVars, bindingsArray } = await respondToSelectQuery(query, parsedQuery);
        res.send(genJsonResults(jsonVars, bindingsArray));
    }
    else if (parsedQuery.resultType === 'quads') {
        const quadsJsonld = await respondToConstructQuery(parsedQuery);
        res.contentType('application/json+ld');
        res.send(quadsJsonld);
    }
    else {
        return next(new Error('SPARQL query must be SELECT form'));
    }
});
// verifiable SPARQL endpoint (fetch)
app.get('/vsparql/', async (req, res, next) => {
    // get query string
    const query = req.query.query;
    if (typeof query !== 'string') {
        return next(new Error('SPARQL query must be given as `query` parameter'));
    }
    // extract variables from SELECT query
    const vars = extractVars(query);
    if (vars == undefined) {
        return next(new Error('malformed SPARQL query'));
    }
    // parse SELECT query
    const parseResult = parseQuery(query);
    if ('error' in parseResult) {
        return next(new Error('malformed SPARQL query')); // TBD
    }
    const { parsedQuery, bgpTriples, whereWithoutBgp, gVarToBgpTriple } = parseResult;
    // get extended bindings, i.e., bindings (SELECT query responses) + associated graph names corresponding to each BGP triples
    const graphPatterns = genGraphPatterns(bgpTriples, df);
    const bindingsArray = await getExtendedBindings(parsedQuery, graphPatterns, df, engine);
    // get revealed credentials
    const anonymizer = new Anonymizer(df);
    const revealedCredsArray = await Promise.all(bindingsArray
        .map((bindings) => identifyCreds(bindings, gVarToBgpTriple))
        .map(async ({ bindings, graphIriToBgpTriple }) => {
        // get revealed documents (without proofs)
        const docs = await getRevealedQuads(graphIriToBgpTriple, graphPatterns, bindings, whereWithoutBgp, vars, df, engine, anonymizer);
        const creds = docs; // TBD: add associated proofs
        return creds;
    }));
    console.dir(anonymizer, { depth: 8 });
    // - for revealedCreds in revealedCredsArray:
    //   - add credential metadata
    //   - hide unspecified variables
    //   - get associated proofs
    // serialize credentials
    const credJsonsArray = [];
    for (const creds of revealedCredsArray) {
        const credJsons = [];
        for (const [_credGraphIri, [_cred, anonymizedCred]] of creds) {
            const credJson = await jsonld.fromRDF(anonymizedCred);
            const credJsonCompact = await jsonld.compact(credJson, CONTEXTS, { documentLoader: customDocLoader });
            credJsons.push(credJsonCompact);
        }
        credJsonsArray.push(credJsons);
    }
    // add VP (or VCs) to bindings
    const bindingsWithVPArray = bindingsArray.map((bindings, i) => bindings.set('vp', df.literal(JSON.stringify(credJsonsArray[i]), df.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON'))));
    // send response
    let jsonVars;
    if (isWildcard(vars)) {
        // SELECT * WHERE {...}
        jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
    }
    else {
        // SELECT ?s ?p ?o WHERE {...} / SELECT (?s AS ?sub) ?p ?o WHERE {...}
        jsonVars = vars.map((v) => 'value' in v ? v.value : v.variable.value);
    }
    jsonVars.push('vp');
    res.send(genJsonResults(jsonVars, bindingsWithVPArray));
    // run rdf-signatures-bbs to get derived proofs
    // attach derived proofs
});
// verifiable SPARQL endpoint (derive proofs)
app.get('/deriveProof/', async (req, res, next) => {
    // request
    //   - (credGraphIri, revealed doc)[]
    //   - hidden iris
    // response
    //   - vp
    // // get original credentials
    // // TBD: unnecessary in fetching stage
    // const credsArray = [];
    // for (const credGraphIriToBgpTriple of credGraphIriToBgpTriples) {
    //   const creds = [];
    //   for (const credGraphIri of credGraphIriToBgpTriple.keys()) {
    //     // get whole document (without proof)
    //     const { items: docWithGraphIri } = await store.get({ graph: df.namedNode(credGraphIri) });
    //     const doc = docWithGraphIri.map((quad) => df.quad(quad.subject, quad.predicate, quad.object)); // remove graph name
    //     // get proofs
    //     const { items: proofIdQuads } = await store.get({ predicate: df.namedNode(PROOF), graph: df.namedNode(credGraphIri) });
    //     const proofs = [];
    //     for (const proofId of proofIdQuads.map((proofIdQuad: RDF.Quad) => proofIdQuad.object.value)) {
    //       const { items: proofQuads } = await store.get({ graph: df.blankNode(proofId) });
    //       proofs.push(proofQuads);
    //     }
    //     creds.push({
    //       doc, proofs
    //     });
    //   };
    //   credsArray.push(creds);
    // };
});
