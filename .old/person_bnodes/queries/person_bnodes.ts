const prefix = `
PREFIX s: <http://schema.org/>
`;

const bodies = [
  // debug
  `
SELECT *
WHERE {
  ?s ?p ?o .
}
`,
  // debug
  `
CONSTRUCT {
  ?s ?p ?o .
}
WHERE {
  ?s ?p ?o .
}
`,
];

const queries: string[] = bodies.map((q) => prefix + q);
export default queries;
