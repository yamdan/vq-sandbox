const prefix = `
PREFIX s: <http://schema.org/>
PREFIX cred: <https://www.w3.org/2018/credentials#>
`;
const bodies = [
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
SELECT ?cid ?s ?givenName ?age ?g
WHERE {
  GRAPH ?g {
    ?s s:age ?age .
    ?s s:givenName ?givenName .
    ?cid cred:credentialSubject ?s .
    FILTER (?age < 25)
  }
}
`,
    `
SELECT ?givenName ?s ?g
WHERE {
  GRAPH ?g {
    ?s s:givenName ?givenName .
  }
}
`,
    `
ASK {
  GRAPH ?g {
    ?s s:givenName ?givenName .
  }
}
`,
    `
CONSTRUCT { ?s s:givenName ?givenName } WHERE {
  GRAPH ?g {
    ?s s:givenName ?givenName .
  }
}
`,
];
const queries = bodies.map((q) => prefix + q);
export default queries;
