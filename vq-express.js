import express from 'express';
import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import { addBnodePrefix, Anonymizer, extractVars, genJsonResults, getExtendedBindings, getRevealedQuads, getDocsAndProofs, identifyCreds, isWildcard, parseQuery, streamToArray, ANON_PREFIX } from './utils.js';
// source documents
import creds from './sample/people_namedgraph_bnodes.json' assert { type: 'json' };
// built-in JSON-LD contexts
import vcv1 from './context/vcv1.json' assert { type: 'json' };
import zkpld from './context/bbs-termwise-2021.json' assert { type: 'json' };
import schemaorg from './context/schemaorg.json' assert { type: 'json' };
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
const VC_FRAME = {
    '@context': CONTEXTS,
    type: 'VerifiableCredential',
    proof: {} // explicitly required otherwise `sec:proof` is used instead
};
const VP_TEMPLATE = {
    '@context': CONTEXTS,
    type: 'VerifiablePresentation',
    verifiableCredential: [],
};
const RDF_PREFIX = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const SEC_PREFIX = 'https://w3id.org/security#';
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
    if ('error' in vars) {
        throw new Error(vars.error);
    }
    // send response
    let jsonVars;
    if (vars.length === 1 && 'value' in vars[0] && vars[0].value === '*') {
        // SELECT * WHERE {...}
        jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
    }
    else {
        // SELECT ?s ?p ?o WHERE {...}
        jsonVars = vars.map((v) => v.value);
    }
    return { jsonVars, bindingsArray };
};
const respondToConstructQuery = async (parsedQuery) => {
    const quadsStream = await parsedQuery.execute();
    const quadsArray = await streamToArray(quadsStream);
    const quadsArrayWithBnodePrefix = quadsArray.map((quad) => addBnodePrefix(quad));
    const quadsJsonld = await jsonld.fromRDF(quadsArrayWithBnodePrefix);
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
        return next(new Error(`malformed query: ${error}`));
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
const fetch = async (query) => {
    // extract variables from SELECT query
    const vars = extractVars(query);
    if ('error' in vars) {
        return vars;
    }
    // parse SELECT query
    const parseResult = parseQuery(query);
    if ('error' in parseResult) {
        return parseResult; // TBD
    }
    const { parsedQuery, bgpTriples, gVarToBgpTriple } = parseResult;
    // get extended bindings, i.e., bindings (SELECT query responses) + associated graph names corresponding to each BGP triples
    const bindingsArray = await getExtendedBindings(bgpTriples, parsedQuery, df, engine);
    // get revealed and anonymized credentials
    const anonymizer = new Anonymizer(df);
    const revealedCredsArray = await Promise.all(bindingsArray
        .map((bindings) => identifyCreds(bindings, gVarToBgpTriple))
        .map(({ bindings, graphIriToBgpTriple }) => getRevealedQuads(graphIriToBgpTriple, bindings, vars, df, anonymizer))
        .map(async (revealedQuads) => getDocsAndProofs(await revealedQuads, store, df, engine, anonymizer)));
    return { vars, bindingsArray, revealedCredsArray };
};
// zk-SPARQL endpoint (fetch)
app.get('/zk-sparql/fetch', async (req, res, next) => {
    // parse query
    const query = req.query.query;
    if (typeof query !== 'string') {
        return { 'error': 'SPARQL query must be given as `query` parameter' };
    }
    const queryResult = await fetch(query);
    if ('error' in queryResult) {
        return next(new Error(queryResult.error));
    }
    const { vars, bindingsArray, revealedCredsArray } = queryResult;
    // serialize credentials
    const vps = [];
    for (const creds of revealedCredsArray) {
        const vcs = [];
        for (const [_credGraphIri, { anonymizedDoc, proofs }] of creds) {
            // remove proof.proofValue
            const proofQuads = proofs.flat().filter((quad) => quad.predicate.value !== `${SEC_PREFIX}proofValue`);
            // concat document and proofs
            const anonymizedCred = anonymizedDoc.concat(proofQuads);
            // add bnode prefix `_:` to blank node ids
            const anonymizedCredWithBnodePrefix = anonymizedCred.map((quad) => addBnodePrefix(quad));
            // RDF to JSON-LD
            const credJson = await jsonld.fromRDF(anonymizedCredWithBnodePrefix);
            // to compact JSON-LD
            const credJsonCompact = await jsonld.compact(credJson, CONTEXTS, { documentLoader: customDocLoader });
            // shape it to be a VC
            const vc = await jsonld.frame(credJsonCompact, VC_FRAME, { documentLoader: customDocLoader });
            vcs.push(vc);
        }
        const vp = Object.assign({}, VP_TEMPLATE);
        vp['verifiableCredential'] = vcs;
        vps.push(vp);
    }
    // add VP (or VCs) to bindings
    const bindingsWithVPArray = bindingsArray.map((bindings, i) => bindings.set('vp', df.literal(`${JSON.stringify(vps[i], null, 2)}`, df.namedNode(`${RDF_PREFIX}JSON`))));
    // send response
    let jsonVars;
    if (isWildcard(vars)) {
        // SELECT * WHERE {...}
        jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
    }
    else {
        // SELECT ?s ?p ?o WHERE {...}
        jsonVars = vars.map((v) => v.value);
    }
    jsonVars.push('vp');
    res.send(genJsonResults(jsonVars, bindingsWithVPArray));
});
// zk-SPARQL endpoint (derive proofs)
app.get('/zk-sparql/', async (req, res, next) => {
    // parse query
    const query = req.query.query;
    if (typeof query !== 'string') {
        return { 'error': 'SPARQL query must be given as `query` parameter' };
    }
    const queryResult = await fetch(query);
    if ('error' in queryResult) {
        return next(new Error(queryResult.error));
    }
    const { vars, bindingsArray, revealedCredsArray } = queryResult;
    // derive proofs
    const vps = [];
    for (const creds of revealedCredsArray) {
        const datasets = [];
        for (const [_credGraphIri, { wholeDoc, revealedDoc, anonymizedDoc, proofs }] of creds) {
            console.log('\nwholeDoc: \n');
            console.dir(wholeDoc, { depth: 7 });
            console.log('\nanonymizedDoc: \n');
            console.dir(anonymizedDoc, { depth: 7 });
            // generate indexed mask, e.g.,
            // {
            //   "1": [ undefined, undefined, "anoni:0", undefined ],
            //   "2": [ undefined, undefined, undefined, undefined ],
            //   "5": [ "anoni:0", undefined, "anoni:1", undefined ]
            // }
            const mask = anonymizedDoc.map((quad) => [
                quad.subject.value.startsWith(ANON_PREFIX) ? quad.subject.value : undefined,
                quad.predicate.value.startsWith(ANON_PREFIX) ? quad.predicate.value : undefined,
                quad.object.value.startsWith(ANON_PREFIX) ? quad.object.value : undefined,
                quad.graph.value.startsWith(ANON_PREFIX) ? quad.graph.value : undefined,
            ]);
            const revealIndex = revealedDoc.map((revealedQuad) => wholeDoc.findIndex((wholeQuad) => wholeQuad.equals(revealedQuad)));
            const indexedMask = Object.fromEntries(revealIndex.map((i, j) => [i, mask[j]]));
            console.log(indexedMask);
            datasets.push({ document: wholeDoc, proof: proofs, revealDocument: mask });
        }
        console.dir(datasets, { depth: 8 });
        // const derivedProofs = deriveProofRdf(datasets, mask, suite, documentLoader);
    }
    // attach derived proofs
    // send response
    let jsonVars;
    if (isWildcard(vars)) {
        // SELECT * WHERE {...}
        jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
    }
    else {
        // SELECT ?s ?p ?o WHERE {...}
        jsonVars = vars.map((v) => v.value);
    }
    //jsonVars.push('vp');
    res.send(genJsonResults(jsonVars, bindingsArray));
});
