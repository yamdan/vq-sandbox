import * as fs from 'fs';
import jsonld from 'jsonld';
import { MemoryLevel } from 'memory-level';
import { DataFactory } from 'rdf-data-factory';
import { Quadstore } from 'quadstore';
import { Engine } from 'quadstore-comunica';
import type * as RDF from '@rdfjs/types';

// SPARQL queries
const sparqlPrefixes = `
PREFIX s: <http://schema.org/>
PREFIX cred: <https://www.w3.org/2018/credentials#>
`;

const sparqlQueries = [
  `
SELECT ?cid ?s
WHERE {
  ?s s:givenName "Jane" .
  ?cid cred:credentialSubject ?s .
}
`,
  `
SELECT ?cid ?s ?givenName ?placeName
WHERE {
  ?cid cred:credentialSubject ?s .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place s:name ?placeName .
  ?place s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
}
`,
  `
SELECT ?cid ?s ?givenName ?age
WHERE {
  ?s s:age ?age .
  ?s s:givenName ?givenName .
  ?cid cred:credentialSubject ?s .
  FILTER (?age < 25)
}
`,
];

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
const f = JSON.parse(fs.readFileSync('./sample/people.jsonld').toString());
const quads = await jsonld.toRDF(f, { documentLoader: customDocLoader }) as RDF.Quad[];

// save quads to quadstore
await store.multiPut(quads);

// execute queries
sparqlQueries.map(async (q) => {
  const stream = await engine.queryBindings(sparqlPrefixes + q);
  stream.on('data', (bindings) => {
    console.log('\n[query]', q);
    console.log('[result]\n', bindings.toString());
  });
})
