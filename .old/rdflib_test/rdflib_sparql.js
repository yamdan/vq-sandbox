import * as fs from 'fs';
import jsonld from 'jsonld';
import * as rdflib from 'rdflib';
// JSON-LD context
import vcv1 from '../../context/vcv1.json' assert { type: 'json' };
import zkpld from '../../context/bbs-termwise-2021.json' assert { type: 'json' };
import schemaorg from '../../context/schemaorg.json' assert { type: 'json' };
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
// JSON-LD to N-Quads
const f = JSON.parse(fs.readFileSync('./sample/people.jsonld').toString());
const store = rdflib.graph();
await jsonld.toRDF(f, { format: 'application/n-quads', documentLoader: customDocLoader }).then((nquads) => {
    rdflib.parse(nquads.toString(), store, 'http://example.org/g1', 'application/n-quads', (nq) => {
        //console.log('\nstore: ', store);
    });
}).catch((e) => console.log(e));
const execQuery = (sparqlQuery) => {
    //const sparqlQuery = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o . }';
    const query = rdflib.SPARQLToQuery(sparqlQuery, false, store);
    //console.log('\nquery: ', query);
    if (query) {
        store.query(query, (bindings) => {
            console.log('\n[query]', sparqlQuery);
            console.log('[result]\n', bindings);
        });
    }
};
// const rl = readline.createInterface({ input, output });
// rl.question('Query> ', (inputQuery) => {
//   execQuery(inputQuery);
// });
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
SELECT ?cid ?s
WHERE {
  ?s s:givenName "John" .
  ?cid cred:credentialSubject ?s .
}
`,
    `
SELECT ?cid ?s
WHERE {
  ?s s:homeLocation <did:example:cityA> .
  ?cid cred:credentialSubject ?s .
}
`,
    `
SELECT ?cid ?s
WHERE {
  ?s s:age ?age .
  ?cid cred:credentialSubject ?s .
  FILTER (?age > 25)
}
`,
];
sparqlQueries.map((q) => execQuery(sparqlPrefixes + q));
