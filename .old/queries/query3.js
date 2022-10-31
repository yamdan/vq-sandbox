const prefix = `
PREFIX s: <http://schema.org/>
PREFIX cred: <https://www.w3.org/2018/credentials#>
`;
const bodies = [
    // 回答可能性の確認
    `
ASK {
  ?s a s:Person ;
     s:givenName ?givenName ;
     s:homeLocation ?place .
  ?place a s:Place ;
         s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
}
`,
    // 回答希望termの指定(verifierが作成)
    `
SELECT ?givenName
WHERE {
  ?s a s:Person .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place a s:Place .
  ?place s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
}
`,
    // named graph(クレデンシャル)の特定
    `
SELECT *
WHERE {
  ?s a s:Person .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place a s:Place .
  ?place s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
  GRAPH ?g1 {
    ?s a s:Person .
  }
  GRAPH ?g2 {
    ?s s:givenName ?givenName .
  }
  GRAPH ?g3 {
    ?s s:homeLocation ?place .
  }
  GRAPH ?g4 {
    ?place a s:Place .
  }
  GRAPH ?g5 {
    ?place s:maximumAttendeeCapacity ?pop .
  }
}
`,
    // quadsの再構成(テスト)
    `
CONSTRUCT {
  ?s a s:Person .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place a s:Place .
  ?place s:maximumAttendeeCapacity ?pop .
} WHERE {
  ?s a s:Person .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place a s:Place .
  ?place s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
}
`,
    //   // debug
    //   `
    // CONSTRUCT { ?s ?p ?o }
    // WHERE {
    //   GRAPH <http://example.org/graph/1> {
    //     ?s ?p ?o .
    //   }
    // }
    // `,
];
const queries = bodies.map((q) => prefix + q);
export default queries;
