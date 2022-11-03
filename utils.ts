import { DataFactory } from 'rdf-data-factory';
import { Engine } from 'quadstore-comunica';
import type * as RDF from '@rdfjs/types';
import sparqljs from 'sparqljs';

// Constants
const GRAPH_VAR_PREFIX = 'ggggg';  // TBD

export const extractVars = (query: string) => {
  const parser = new sparqljs.Parser();
  try {
    const parsedQuery = parser.parse(query);
    if (!(parsedQuery.type === 'query' && parsedQuery.queryType === 'SELECT')) {
      return undefined;
    }
    return parsedQuery.variables;
  } catch (error) {
    return undefined;
  }
}

// identify credentials related to the given query
export const identifyCreds = async (query: string, df: DataFactory<RDF.Quad>, engine: Engine) => {
  // parse the original SELECT query to get Basic Graph Pattern (BGP)
  const parser = new sparqljs.Parser();
  let parsedQuery;
  try {
    parsedQuery = parser.parse(query);
    if (!(parsedQuery.type === 'query' && parsedQuery.queryType === 'SELECT')) {
      return undefined;
    }
  } catch (error) {
    return undefined;
  }
  const bgpPattern = parsedQuery.where?.filter((p) => p.type === 'bgp')[0] as sparqljs.BgpPattern;
  const bgpTriples = bgpPattern.triples;
  const whereWithoutBgp = parsedQuery.where?.filter((p) => p.type !== 'bgp');
  // create graph patterns based on BGPs 
  const graphPatterns: sparqljs.GraphPattern[] = bgpTriples.map((triple, i) => {
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
  const graphVarToBgpTriple: Record<string, sparqljs.Triple> = Object.assign({}, ...bgpTriples.map((triple, i) => ({
    [`${GRAPH_VAR_PREFIX}${i}`]: triple
  })));

  // generate a new SELECT query to identify named graphs
  parsedQuery.distinct = true;
  if (!isWildcard(parsedQuery.variables)) {
    parsedQuery.variables = parsedQuery.variables.concat([...Array(graphPatterns.length)].map((_, i) => df.variable(`${GRAPH_VAR_PREFIX}${i}`)));
  }
  parsedQuery.where = parsedQuery.where?.concat(graphPatterns); // update WHERE
  const generator = new sparqljs.Generator();
  const generatedQuery = generator.stringify(parsedQuery);

  // extract identified graphs from the query result
  const bindingsStream = await engine.queryBindings(generatedQuery, { unionDefaultGraph: true });
  const bindingsArray = await streamToArray(bindingsStream);

  const credGraphIriToBgpTriples: Map<string, sparqljs.Triple[]>[] = [];
  for (const bindings of bindingsArray) {
    const graphIriAndGraphVars = [...bindings].filter((b) => b[0].value.startsWith(GRAPH_VAR_PREFIX)).map(([gVar, gIri]) => [gIri.value, gVar.value]);
    const graphIriAndBgpTriples: [string, sparqljs.Triple][] = graphIriAndGraphVars.map(([gIri, gVar]) => [gIri, graphVarToBgpTriple[gVar]]);
    const graphIriToBgpTriples = entriesToMap(graphIriAndBgpTriples);
    credGraphIriToBgpTriples.push(graphIriToBgpTriples);
  };
  return { credGraphIriToBgpTriples, bindingsArray, whereWithoutBgp };
};

export const getRevealedQuads = async (credGraphIriToBgpTriple: Map<string, sparqljs.Triple[]>, whereWithoutBgp: sparqljs.Pattern[] | undefined, df: DataFactory<RDF.Quad>, engine: Engine) => {
  const graphPatterns: sparqljs.Pattern[] = [...credGraphIriToBgpTriple.entries()].map(([credGraphIri, bgpTriples]) => {
    const bgpPattern: sparqljs.BgpPattern =
    {
      type: 'bgp',
      triples: bgpTriples
    };
    const graphPattern: sparqljs.GraphPattern = {
      type: 'graph',
      patterns: [bgpPattern],
      name: df.namedNode(credGraphIri)
    };
    return graphPattern;
  });
  const where = whereWithoutBgp ? graphPatterns.concat(whereWithoutBgp) : graphPatterns;

  const parsedQuery: sparqljs.ConstructQuery = {
    queryType: 'CONSTRUCT',
    type: 'query',
    prefixes: {},
  };
  parsedQuery.where = where;

  const result = new Map<string, RDF.Quad[]>();
  for (const [credGraphIri, bgpTriples] of credGraphIriToBgpTriple.entries()) {
    parsedQuery.template = bgpTriples;
    const generator = new sparqljs.Generator();
    const generatedQuery = generator.stringify(parsedQuery);
    const quadsStream = await engine.queryQuads(generatedQuery, { unionDefaultGraph: true });
    const quadsArray = await streamToArray(quadsStream);
    result.set(credGraphIri, quadsArray);
  }
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

export const isWildcard = (vars: sparqljs.Variable[] | [sparqljs.Wildcard]): vars is [sparqljs.Wildcard] =>
  vars.length === 1 && 'value' in vars[0] && vars[0].value === '*';
