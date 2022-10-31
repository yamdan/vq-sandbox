const prefix = `
PREFIX s: <http://schema.org/>
PREFIX cred: <https://www.w3.org/2018/credentials#>
`;

const bodies = [
  // debug
  `
CONSTRUCT { ?s ?p ?o }
WHERE {
  GRAPH <http://example.org/graph/1> {
    ?s ?p ?o .
  }
}
`,
  // debug
  `
CONSTRUCT { ?s ?p ?o }
WHERE {
  GRAPH <http://example.org/graph/2> {
    ?s ?p ?o .
  }
}
`,
];

const queries: string[] = bodies.map((q) => prefix + q);
export default queries;
