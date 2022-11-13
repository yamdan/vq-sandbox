import express from 'express';
import jsonld from 'jsonld';
import canonize from 'rdf-canonize';
import * as RDF from '@rdfjs/types';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import { BbsTermwiseSignatureProof2021 } from '@zkp-ld/rdf-signatures-bbs';
import { addBnodePrefix, Anonymizer, extractVars, genJsonResults, getExtendedBindings, getRevealedQuads, getDocsAndProofs, identifyCreds, isWildcard, parseQuery, streamToArray, PROOF, VC_TYPE } from './utils.js';

// source documents
import creds from './sample/people_namedgraph_bnodes.json' assert { type: 'json' };

// built-in JSON-LD contexts
import vcv1 from './context/vcv1.json' assert { type: 'json' };
import zkpld from './context/bbs-termwise-2021.json' assert { type: 'json' };
import schemaorg from './context/schemaorg.json' assert { type: 'json' };
import { customLoader, builtinDIDDocs, builtinContexts } from "./data/index.js";

const URL_TO_CONTEXTS = new Map([
  ['https://www.w3.org/2018/credentials/v1', vcv1],
  ['https://zkp-ld.org/bbs-termwise-2021.jsonld', zkpld],
  ['https://schema.org', schemaorg],
]);
const CONTEXTS = [...URL_TO_CONTEXTS.keys()] as unknown as jsonld.ContextDefinition; // TBD
const documentLoader = customLoader(new Map([
  ...builtinDIDDocs,
  ...builtinContexts,
]));

const VC_FRAME =
{
  '@context': CONTEXTS,
  type: 'VerifiableCredential',
  proof: {}  // explicitly required otherwise `sec:proof` is used instead
};
type VP =
  {
    '@context': any;
    type: 'VerifiablePresentation';
    verifiableCredential: jsonld.NodeObject[];
  };
const VP_TEMPLATE: VP =
{
  '@context': CONTEXTS,
  type: 'VerifiablePresentation',
  verifiableCredential: [],
};
const RDF_PREFIX = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const SEC_PREFIX = 'https://w3id.org/security#';

// setup quadstore
const backend = new MemoryLevel();
const df = new DataFactory();
const store = new Quadstore({ backend, dataFactory: df });
const engine = new Engine(store);
await store.open();

// store initial documents
const scope = await store.initScope();  // for preventing blank node collisions
const quads = await jsonld.toRDF(creds, { documentLoader }) as RDF.Quad[];
await store.multiPut(quads, { scope });

// setup express server
const app = express();
const port = 3000;
app.disable('x-powered-by');
app.listen(port, () => {
  console.log('started on port 3000');
});

const respondToSelectQuery = async (query: string, parsedQuery: RDF.QueryBindings<RDF.AllMetadataSupport>) => {
  const bindingsStream = await parsedQuery.execute();
  const bindingsArray = await streamToArray(bindingsStream);

  // extract variables from SELECT query
  const vars = extractVars(query);
  if ('error' in vars) {
    throw new Error(vars.error);
  }

  // send response
  let jsonVars: string[];
  if (vars.length === 1 && 'value' in vars[0] && vars[0].value === '*') {
    // SELECT * WHERE {...}
    jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
  } else {
    // SELECT ?s ?p ?o WHERE {...}
    jsonVars = vars.map((v) => v.value);
  }
  return { jsonVars, bindingsArray };
};

const respondToConstructQuery = async (parsedQuery: RDF.QueryQuads<RDF.AllMetadataSupport>) => {
  const quadsStream = await parsedQuery.execute();
  const quadsArray = await streamToArray(quadsStream);
  const quadsArrayWithBnodePrefix = addBnodePrefix(quadsArray);
  const quadsJsonld = await jsonld.fromRDF(quadsArrayWithBnodePrefix);
  const quadsJsonldCompact = await jsonld.compact(quadsJsonld, CONTEXTS, { documentLoader });
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
  let parsedQuery: RDF.Query<RDF.AllMetadataSupport>;
  try {
    parsedQuery = await engine.query(query, { unionDefaultGraph: true });
  } catch (error) {
    return next(new Error(`malformed query: ${error}`));
  }

  // execute query
  if (parsedQuery.resultType === 'bindings') {
    const { jsonVars, bindingsArray } = await respondToSelectQuery(query, parsedQuery)
    res.send(genJsonResults(jsonVars, bindingsArray));
  } else if (parsedQuery.resultType === 'quads') {
    const quadsJsonld = await respondToConstructQuery(parsedQuery);
    res.contentType('application/json+ld');
    res.send(quadsJsonld);
  } else {
    return next(new Error('SPARQL query must be SELECT form'));
  }
});

const fetch = async (query: string) => {
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
  const bindingsArray = await getExtendedBindings(
    bgpTriples, parsedQuery, df, engine);

  // get revealed and anonymized credentials
  const anonymizer = new Anonymizer(df);
  const revealedCredsArray = await Promise.all(
    bindingsArray
      .map((bindings) =>
        identifyCreds(
          bindings,
          gVarToBgpTriple))
      .map(({ bindings, graphIriToBgpTriple }) =>
        getRevealedQuads(
          graphIriToBgpTriple,
          bindings,
          vars,
          df,
          anonymizer))
      .map(async (revealedQuads) =>
        getDocsAndProofs(
          await revealedQuads,
          store,
          df,
          engine,
          anonymizer)));

  const anonToTerm = anonymizer.anonToTerm;
  return { vars, bindingsArray, revealedCredsArray, anonToTerm };
}

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
  const vps: VP[] = [];
  for (const creds of revealedCredsArray) {
    const vcs: jsonld.NodeObject[] = [];
    for (const [_credGraphIri, { anonymizedDoc, proofs }] of creds) {
      // remove proof.proofValue
      const proofQuads = proofs.flat().filter(
        (quad) =>
          quad.predicate.value !== `${SEC_PREFIX}proofValue`
      );
      // concat document and proofs
      const anonymizedCred = anonymizedDoc.concat(proofQuads);
      // add bnode prefix `_:` to blank node ids
      const anonymizedCredWithBnodePrefix = addBnodePrefix(anonymizedCred);
      // RDF to JSON-LD
      const credJson = await jsonld.fromRDF(anonymizedCredWithBnodePrefix);
      // to compact JSON-LD
      const credJsonCompact = await jsonld.compact(credJson, CONTEXTS, { documentLoader });
      // shape it to be a VC
      const vc = await jsonld.frame(credJsonCompact, VC_FRAME, { documentLoader });
      vcs.push(vc);
    }
    const vp = { ...VP_TEMPLATE };
    vp['verifiableCredential'] = vcs;
    vps.push(vp);
  }

  // add VP (or VCs) to bindings
  const bindingsWithVPArray = bindingsArray.map(
    (bindings, i) =>
      bindings.set('vp', df.literal(
        `${JSON.stringify(vps[i], null, 2)}`,
        df.namedNode(`${RDF_PREFIX}JSON`))));

  // send response
  let jsonVars: string[];
  if (isWildcard(vars)) {
    // SELECT * WHERE {...}
    jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
  } else {
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
  const { vars, bindingsArray, revealedCredsArray, anonToTerm } = queryResult;

  // derive proofs
  const vps: VP[] = [];
  for (const creds of revealedCredsArray) {
    const inputDocuments = [];
    const datasetsForDebug = [];

    for (const [_credGraphIri, { wholeDoc, anonymizedDoc, proofs }] of creds) {
      // remove proof from whole document and anonymized document
      inputDocuments.push({
        document: wholeDoc.filter((quad) => quad.predicate.value !== PROOF),
        proofs,
        revealedDocument: anonymizedDoc.filter((quad) => quad.predicate.value !== PROOF),
        anonToTerm
      });
    }

    const suite = new BbsTermwiseSignatureProof2021({
      useNativeCanonize: false,
    });

    const derivedProofs: any = await suite.deriveProofMultiRDF({
      inputDocuments,
      documentLoader,
    });

    // debug
    // const { dataset: canonicalizedNquads, issuer: c14nMap }
    //   = await canonize.canonize(addBnodePrefix(wholeDoc), {
    //     algorithm: 'URDNA2015', format: 'application/n-quads'
    //   });
    // const wholeNquads = canonize.NQuads.serialize(addBnodePrefix(
    //   wholeDoc.filter((quad) => quad.predicate.value !== PROOF)));
    // const proofsNquads = proofs.map((proof) => canonize.NQuads.serialize(addBnodePrefix(proof)));
    // const anonymizedNquads = canonize.NQuads.serialize(addBnodePrefix(
    //   anonymizedDoc.filter((quad) => quad.predicate.value !== PROOF)));
    // datasetsForDebug.push({ wholeNquads, proofsNquads, anonymizedNquads, canonicalizedNquads, anonToTerm, c14nMap });

    // console.log(`const document = \`\n${wholeNquads}\n\`\;`);
    // console.log(`const revealedDocument = \`\n${anonymizedNquads}\`\;`);
    // console.log(`const proofs = \`\n${proofsNquads}\n\`\;`);
    // console.log(`const anonToTerm =\n`);
    // console.dir(anonToTerm);
    console.dir(derivedProofs, { depth: 8 });

    // // add bnode prefix `_:` to blank node ids
    // const anonymizedCredWithBnodePrefix = addBnodePrefix(cred);

    // RDF to JSON-LD
    const vcs: jsonld.NodeObject[] = [];
    for (const { document, proof: proofs } of derivedProofs) {
      const documentId = document.find(
        (quad: RDF.Quad) => quad.predicate.value === RDF_TYPE && quad.object.value === VC_TYPE)
        .subject;
      const proofGraphs = [];
      for (const proof of proofs) {
        const proofGraphId = df.blankNode();
        const proofGraph = proof.map((quad: RDF.Quad) =>
          df.quad(quad.subject, quad.predicate, quad.object, proofGraphId));
        proofGraphs.push(proofGraph);
        document.push(df.quad(documentId, df.namedNode(PROOF), proofGraphId));
      }
      const cred = document.concat(proofGraphs.flat());
      const credJson = await jsonld.fromRDF(cred);
      console.log(`credJson = ${JSON.stringify(credJson, null, 2)}`);
      // to compact JSON-LD
      const credJsonCompact = await jsonld.compact(credJson, CONTEXTS, { documentLoader });
      // shape it to be a VC
      const vc = await jsonld.frame(credJsonCompact, VC_FRAME, { documentLoader });
      vcs.push(vc);
    }

    // serialize credentials
    const vp = { ...VP_TEMPLATE };
    vp['verifiableCredential'] = vcs;
    vps.push(vp);
  }

  // add VP (or VCs) to bindings
  const bindingsWithVPArray = bindingsArray.map(
    (bindings, i) =>
      bindings.set('vp', df.literal(
        `${JSON.stringify(vps[i], null, 2)}`,
        df.namedNode(`${RDF_PREFIX}JSON`))));

  // send response
  let jsonVars: string[];
  if (isWildcard(vars)) {
    // SELECT * WHERE {...}
    jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
  } else {
    // SELECT ?s ?p ?o WHERE {...}
    jsonVars = vars.map((v) => v.value);
  }
  jsonVars.push('vp');
  res.send(genJsonResults(jsonVars, bindingsWithVPArray));
})