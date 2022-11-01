import express from 'express';
import jsonld from 'jsonld';
import * as RDF from '@rdfjs/types';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import { extractVars, identifyCreds as identifyCreds, streamToArray } from './utils.js';

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
const CONTEXTS = [...URL_TO_CONTEXTS.keys()] as unknown as jsonld.ContextDefinition; // TBD
const customDocLoader = (url: string): any => {
  const context = URL_TO_CONTEXTS.get(url);
  if (context) {
    return {
      contextUrl: null, // this is for a context via a link header
      document: context, // this is the actual document that was loaded
      documentUrl: url // this is the actual context URL after redirects
    };
  }
  throw new Error(
    `Error attempted to load document remotely, please cache '${url}'`
  );
};

// setup quadstore
const backend = new MemoryLevel();
const df = new DataFactory();
const store = new Quadstore({ backend, dataFactory: df });
const engine = new Engine(store);
await store.open();

// store initial documents
const scope = await store.initScope();  // for preventing blank node collisions
const quads = await jsonld.toRDF(creds, { documentLoader: customDocLoader }) as RDF.Quad[];
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
  let parsedQuery: RDF.Query<RDF.AllMetadataSupport>;
  try {
    parsedQuery = await engine.query(query, { unionDefaultGraph: true });
  } catch (error) {
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
  const credToTriples = await identifyCreds(query, df, engine);
  if (credToTriples == undefined) {
    return next(new Error('SPARQL query must be SELECT form'));
  }

  // get target credentials
  const credsArray = [];
  for (const credToTriple of credToTriples) {
    const creds = [];
    for (const credGraphIRI of credToTriple.keys()) {
      // get document (credential without proof)
      const { items: docWithGraphIRI } = await store.get({ graph: df.namedNode(credGraphIRI) });
      const doc = docWithGraphIRI.map((quad) => df.quad(quad.subject, quad.predicate, quad.object)); // remove graph name
      // get proofs
      const { items: proofIDQuads } = await store.get({ predicate: df.namedNode(PROOF), graph: df.namedNode(credGraphIRI) });
      const proofs = [];
      for (const proofID of proofIDQuads.map((proofIDQuad: RDF.Quad) => proofIDQuad.object.value)) {
        const { items: proofQuads } = await store.get({ graph: df.blankNode(proofID) });
        proofs.push(proofQuads);
      }
      creds.push({
        doc, proofs
      });
    };
    credsArray.push(creds);
  };

  // TBD: get revealed credentials

  // serialize credentials
  const credJSONs: jsonld.NodeObject[] = [];
  for (const creds of credsArray) {
    for (const cred of creds) {
      const credJSON = await jsonld.fromRDF(cred.doc.concat(cred.proofs.flat()));
      const credJSONCompact = await jsonld.compact(credJSON, CONTEXTS, { documentLoader: customDocLoader });
      credJSONs.push(credJSONCompact);
    }
  }

  // add VP (or VCs) to bindings
  const bindingsWithVPArray = bindingsArray.map((bindings, i) =>
    bindings.set('vp', df.literal(JSON.stringify(credJSONs[i]), df.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON')))
  );

  // send response
  type jsonBindingsURIType = {
    type: 'uri', value: string
  };
  type jsonBindingsLiteralType = {
    type: 'literal', value: string, 'xml:lang'?: string, datatype?: string
  };
  type jsonBindingsBnodeType = {
    type: 'bnode', value: string
  };
  type jsonBindingsType = jsonBindingsURIType | jsonBindingsLiteralType | jsonBindingsBnodeType;
  const isNotNullOrUndefined = <T>(v?: T | null): v is T => null != v;
  let jsonVars: string[];
  if (vars.length === 1 && 'value' in vars[0] && vars[0].value === '*') {
    // SELECT * WHERE {...}
    jsonVars = bindingsArray.length >= 1 ? [...bindingsArray[0].keys()].map((k) => k.value) : [''];
  } else {
    // SELECT ?s ?p ?o WHERE {...} / SELECT (?s AS ?sub) ?p ?o WHERE {...}
    jsonVars = vars.map((v) => 'value' in v ? v.value : v.variable.value);
  }
  jsonVars.push('vp');

  const jsonBindingsArray = [];
  for (const bindings of bindingsWithVPArray) {
    const jsonBindingsEntries: [string, jsonBindingsType][] = [...bindings].map(([k, v]) => {
      let value: jsonBindingsType;
      if (v.termType === 'Literal') {
        if (v.language !== '') {
          value = {
            type: 'literal',
            value: v.value,
            'xml:lang': v.language
          };
        } else if (v.datatype.value === 'http://www.w3.org/2001/XMLSchema#string') {
          value = {
            type: 'literal',
            value: v.value
          };
        } else {
          value = {
            type: 'literal',
            value: v.value,
            datatype: v.datatype.value
          };
        }
      } else if (v.termType === 'NamedNode') {
        value = {
          type: 'uri',
          value: v.value
        };
      } else if (v.termType === 'BlankNode') {
        value = {
          type: 'bnode',
          value: v.value
        };
      } else {
        return undefined;
      };
      return [k.value, value];
    }).filter(isNotNullOrUndefined) as [string, jsonBindingsType][];
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
