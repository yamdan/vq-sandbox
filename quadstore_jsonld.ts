import * as fs from 'fs';
import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import type * as RDF from '@rdfjs/types';

// SPARQL queries
import queries from './queries/query2.js';

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

// JSON-LD to N-Quads
const backend = new MemoryLevel();
const df = new DataFactory();
const store = new Quadstore({ backend, dataFactory: df });
const engine = new Engine(store);
await store.open();

// load JSON-LD credentials
const SOURCE = './sample/people_namedgraph.jsonld';
const doc = JSON.parse(fs.readFileSync(SOURCE).toString());
const quads = await jsonld.toRDF(doc, { documentLoader: customDocLoader }) as RDF.Quad[];

// save quads to quadstore
await store.multiPut(quads);

// execute queries
queries.map(async (q) => {
  const result = await engine.query(q, { unionDefaultGraph: true });
  console.log('[debug] ', result);
  if (result.resultType === 'bindings') {
    const bindingsStream = await result.execute();
    bindingsStream.on('data', (bindings) => {
      console.log('\n[query]', q);
      console.log('[result]\n', bindings.toString());
    });
  } else if (result.resultType === 'quads') {
    const quadStream = await result.execute();
    console.log('\n[query]', q);
    quadStream.on('data', (quad) => {
      console.log('[result]\n', quad);
    })
  } else if (result.resultType === 'boolean') {
    const askResult = await result.execute();
    console.log('\n[query]', q);
    console.log('[result]\n', askResult);
  }
})
