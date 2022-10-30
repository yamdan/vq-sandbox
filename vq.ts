import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import type * as RDF from '@rdfjs/types';
import { identifyGraphs, streamToArray } from './utils.js';

// SPARQL queries
import { selectQuery } from './queries/query_vq.js';

// source documents
import source from './sample/people_namedgraph_bnodes.json' assert { type: 'json'};

// JSON-LD context
import vcv1 from './context/vcv1.json' assert { type: 'json' };
import zkpld from './context/bbs-termwise-2021.json' assert { type: 'json' };
import schemaorg from './context/schemaorg.json' assert { type: 'json' };
const documents: any = {
  'https://www.w3.org/2018/credentials/v1': vcv1,
  'https://zkp-ld.org/bbs-termwise-2021.jsonld': zkpld,
  'https://schema.org': schemaorg
};
const customDocLoader = (url: string): any => {
  const context = documents[url];
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

// store JSON-LD documents
const scope = await store.initScope();  // for preventing blank node collisions
const quads = await jsonld.toRDF(source, { documentLoader: customDocLoader }) as RDF.Quad[];
await store.multiPut(quads, { scope });

// execute SELECT queries
const bindingsStream = await engine.queryBindings(selectQuery, { unionDefaultGraph: true });
const bindings = await streamToArray(bindingsStream);
if (bindings.length === 0) {
  console.error('SELECT query matches nothing');
};

// identify target graphs based on BGP
const graphToTriples = await identifyGraphs(selectQuery, df, engine);
console.dir(graphToTriples, { depth: null });

// get graphs
const credsArray = [];
for (const graphToTriple of graphToTriples) {
  const creds = [];
  for (const graphIRI of graphToTriple.keys()) {
    const { items } = await store.get({ graph: df.namedNode(graphIRI) });
    creds.push(items);
  };
  credsArray.push(creds);
};
console.dir(credsArray[0], { depth: null });

// TBD: get associated proofs
