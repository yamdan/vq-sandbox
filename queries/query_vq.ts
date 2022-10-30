export const selectQuery = `
PREFIX s: <http://schema.org/>
PREFIX cred: <https://www.w3.org/2018/credentials#>
SELECT ?givenName
WHERE {
  ?s a s:Person .
  ?s s:givenName ?givenName .
  ?s s:homeLocation ?place .
  ?place a s:Place .
  ?place s:maximumAttendeeCapacity ?pop .
  FILTER (?pop > 25000)
}
`;

// named graph(クレデンシャル)の特定
export const identifyGraphs = `
PREFIX s: <http://schema.org/>
PREFIX cred: <https://www.w3.org/2018/credentials#>
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
`;

// quadsの再構成(テスト)
export const constructQuery = `
PREFIX s: <http://schema.org/>
PREFIX cred: <https://www.w3.org/2018/credentials#>
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
`;
