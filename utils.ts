import { DataFactory } from 'rdf-data-factory';
import { Engine } from 'quadstore-comunica';
import type * as RDF from '@rdfjs/types';
import sparqljs from 'sparqljs';

// Constants
const GRAPH_VAR_PREFIX = 'ggggg';  // TBD

// utility function to identify graphs
export const identifyGraphs = async (selectQuery: string, df: DataFactory<RDF.Quad>, engine: Engine) => {
  // parse the original SELECT query to get Basic Graph Pattern (BGP)
  const parser = new sparqljs.Parser();
  const parsedQuery = parser.parse(selectQuery) as sparqljs.SelectQuery;
  if (parsedQuery.queryType !== 'SELECT') {
    console.error('Query must be SELECT query');
  };
  const bgpPattern = parsedQuery.where?.filter((p) => p.type === 'bgp')[0] as sparqljs.BgpPattern;

  const graphPatterns: sparqljs.GraphPattern[] = bgpPattern.triples.map((triple, i) => {
    const patterns: sparqljs.BgpPattern[] = [
      {
        type: 'bgp',
        triples: [triple]
      }
    ];
    const name = df.variable(`${GRAPH_VAR_PREFIX}${i}`);
    return {
      type: 'graph',
      patterns,
      name
    };
  });

  // prepare mapping from graph variables to triples
  const graphVarToTriple: Record<string, sparqljs.Triple> = Object.assign({}, ...bgpPattern.triples.map((triple, i) => ({
    [`${GRAPH_VAR_PREFIX}${i}`]: triple
  })));

  // generate a new query to identify named graphs
  parsedQuery.variables = [...Array(graphPatterns.length)].map((_, i) => df.variable(`${GRAPH_VAR_PREFIX}${i}`));
  parsedQuery.where = parsedQuery.where?.concat(graphPatterns);
  const generator = new sparqljs.Generator();
  const generatedQuery = generator.stringify(parsedQuery);

  // extract identified graphs from the query result
  const bindingsStream = await engine.queryBindings(generatedQuery, { unionDefaultGraph: true });
  const bindingsArray = await streamToArray(bindingsStream);
  const result: Map<string, sparqljs.Triple[]>[] = [];
  for (const bindings of bindingsArray) {
    const graphAndGraphVars = [...bindings].map((b) => ([b[1].value, b[0].value]));
    const graphAndPatterns: [string, sparqljs.Triple][] = graphAndGraphVars.map(([graph, gvar]) => [graph, graphVarToTriple[gvar]]);
    const graphToTriples = entriesToMap(graphAndPatterns);
    result.push(graphToTriples);
  };
  return result;
};

// utility function from [string, T][] to Map<string, T[]>
export const entriesToMap = <T>(entries: [string, T][]) => {
  const res = new Map<string, T[]>();
  for (const entry of entries) {
    if (res.has(entry[0])) {
      res.get(entry[0])?.push(entry[1]);
    } else {
      res.set(entry[0], [entry[1]]);
    };
  };
  return res;
};

// ref: https://github.com/belayeng/quadstore-comunica/blob/master/spec/src/utils.ts
export const streamToArray = <T>(source: RDF.ResultStream<T>): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    const items: T[] = [];
    source.on('data', (item) => {
      items.push(item);
    });
    source.on('end', () => {
      resolve(items);
    });
    source.on('error', (err) => {
      reject(err);
    });
  });
};
