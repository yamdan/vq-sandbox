const prefix = `
PREFIX s: <http://schema.org/>
PREFIX cred: <https://www.w3.org/2018/credentials#>
`;
const bodies = [
    // 回答可能性の確認
    `
ASK {
  ?cid cred:credentialSubject ?s .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place s:name ?placeName .
  ?place s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
}
`,
    // 回答希望termの指定
    `
SELECT ?cid ?s ?givenName ?placeName ?pop
WHERE {
  ?cid cred:credentialSubject ?s .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place s:name ?placeName .
  ?place s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
}
`,
    // named graph(クレデンシャル)の特定
    `
SELECT *
WHERE {
  ?cid cred:credentialSubject ?s .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place s:name ?placeName .
  ?place s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
  GRAPH ?g1 {
    ?cid cred:credentialSubject ?s .
  }
  GRAPH ?g2 {
    ?s s:givenName ?givenName .
  }
  GRAPH ?g3 {
    ?s s:homeLocation ?place .
  }
  GRAPH ?g4 {
    ?place s:name ?placeName .
  }
  GRAPH ?g5 {
    ?place s:maximumAttendeeCapacity ?pop .
  }
}
`,
    // quadsの再構成(テスト)
    `
CONSTRUCT {
  ?cid cred:credentialSubject ?s .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place s:name ?placeName .
  ?place s:maximumAttendeeCapacity ?pop .
} WHERE {
  ?cid cred:credentialSubject ?s .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place s:name ?placeName .
  ?place s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
  GRAPH ?g1 {
    ?cid cred:credentialSubject ?s .
  }
  GRAPH ?g2 {
    ?s s:givenName ?givenName .
  }
  GRAPH ?g3 {
    ?s s:homeLocation ?place .
  }
  GRAPH ?g4 {
    ?place s:name ?placeName .
  }
  GRAPH ?g5 {
    ?place s:maximumAttendeeCapacity ?pop .
  }
}
`,
];
const queries = bodies.map((q) => prefix + q);
export default queries;
