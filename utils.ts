import { DataFactory } from 'rdf-data-factory';
import { Engine } from 'quadstore-comunica';
import type * as RDF from '@rdfjs/types';
import sparqljs from 'sparqljs';

// Constants
const GRAPH_VAR_PREFIX = 'ggggg';  // TBD

export const extractVars = (query: string) => {
  const parser = new sparqljs.Parser();
  const parsedQuery = parser.parse(query);
  if (!(parsedQuery.type === 'query' && parsedQuery.queryType === 'SELECT')) {
    return undefined;
  }
  return parsedQuery.variables;
}

// identify credentials related to the given query
export const identifyCreds = async (query: string, df: DataFactory<RDF.Quad>, engine: Engine) => {
  // parse the original SELECT query to get Basic Graph Pattern (BGP)
  const parser = new sparqljs.Parser();
  const parsedQuery = parser.parse(query);
  if (!(parsedQuery.type === 'query' && parsedQuery.queryType === 'SELECT')) {
    return undefined;
  }

  const bgpPattern = parsedQuery.where?.filter((p) => p.type === 'bgp')[0] as sparqljs.BgpPattern;

  // create graph patterns based on BGPs 
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
  const graphVarToBgpTriple: Record<string, sparqljs.Triple> = Object.assign({}, ...bgpPattern.triples.map((triple, i) => ({
    [`${GRAPH_VAR_PREFIX}${i}`]: triple
  })));

  // generate a new SELECT query to identify named graphs
  parsedQuery.variables = [...Array(graphPatterns.length)].map((_, i) => df.variable(`${GRAPH_VAR_PREFIX}${i}`));
  parsedQuery.where = parsedQuery.where?.concat(graphPatterns);
  const generator = new sparqljs.Generator();
  const generatedQuery = generator.stringify(parsedQuery);
  console.log(generatedQuery);

  // extract identified graphs from the query result
  const bindingsStream = await engine.queryBindings(generatedQuery, { unionDefaultGraph: true });
  const bindingsArray = await streamToArray(bindingsStream);
  const result: Map<string, sparqljs.Triple[]>[] = [];
  for (const bindings of bindingsArray) {
    const graphIriAndGraphVars = [...bindings].map((b) => ([b[1].value, b[0].value]));
    const graphIriAndBgpTriples: [string, sparqljs.Triple][] = graphIriAndGraphVars.map(([graph, gvar]) => [graph, graphVarToBgpTriple[gvar]]);
    const graphIriToBgpTriples = entriesToMap(graphIriAndBgpTriples);
    result.push(graphIriToBgpTriples);
  };
  return result;
};

export const getRevealedQuads = async (credGraphIri: string, bgpTriples: sparqljs.Triple[], query: string, df: DataFactory<RDF.Quad>, engine: Engine) => {
  const parser = new sparqljs.Parser();
  const parsedSelectQuery = parser.parse(query);
  if (!(parsedSelectQuery.type === 'query' && parsedSelectQuery.queryType === 'SELECT')) {
    return undefined;
  }
  const parsedQuery: sparqljs.ConstructQuery = {
    queryType: 'CONSTRUCT',
    type: 'query',
    prefixes: {},
  };
  parsedQuery.where = parsedSelectQuery.where;
  parsedQuery.template = bgpTriples;
  const generator = new sparqljs.Generator();
  const generatedQuery = generator.stringify(parsedQuery);
  console.log(credGraphIri);
  console.log(generatedQuery);
  const quadsStream = await engine.queryQuads(generatedQuery, { unionDefaultGraph: true });
  const quadsArray = await streamToArray(quadsStream);
  return quadsArray;
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

export const genJsonResults = (jsonVars: string[], bindingsArray: RDF.Bindings[]) => {
  type jsonBindingsUriType = {
    type: 'uri', value: string
  };
  type jsonBindingsLiteralType = {
    type: 'literal', value: string, 'xml:lang'?: string, datatype?: string
  };
  type jsonBindingsBnodeType = {
    type: 'bnode', value: string
  };
  type jsonBindingsType = jsonBindingsUriType | jsonBindingsLiteralType | jsonBindingsBnodeType;
  const isNotNullOrUndefined = <T>(v?: T | null): v is T => null != v;

  const jsonBindingsArray = [];
  for (const bindings of bindingsArray) {
    const jsonBindingsEntries: [string, jsonBindingsType][] = [...bindings].map(([k, v]) => {
      let value: jsonBindingsType;
      if (v.termType === 'Literal') {
        if (v.language !== '') {
          value = {
            type: 'literal',
            value: v.value,
            'xml:lang': v.language
          };
        } else if (v.datatype.value === 'http://www.w3.org/2001/XMLSchema#string') {
          value = {
            type: 'literal',
            value: v.value
          };
        } else {
          value = {
            type: 'literal',
            value: v.value,
            datatype: v.datatype.value
          };
        }
      } else if (v.termType === 'NamedNode') {
        value = {
          type: 'uri',
          value: v.value
        };
      } else if (v.termType === 'BlankNode') {
        value = {
          type: 'bnode',
          value: v.value
        };
      } else {
        return undefined;
      };
      return [k.value, value];
    }).filter(isNotNullOrUndefined) as [string, jsonBindingsType][];
    const jsonBindings = Object.fromEntries(jsonBindingsEntries);
    jsonBindingsArray.push(jsonBindings);
  }
  const jsonResults = {
    "head": { "vars": jsonVars },
    "results": {
      "bindings": jsonBindingsArray
    }
  };
  return jsonResults;
}