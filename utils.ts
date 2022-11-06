import { DataFactory } from 'rdf-data-factory';
import { Engine } from 'quadstore-comunica';
import * as RDF from '@rdfjs/types';
import sparqljs from 'sparqljs';
import { nanoid } from 'nanoid';
import { Quadstore } from 'quadstore';

// Constants
const VC_TYPE = 'https://www.w3.org/2018/credentials#VerifiableCredential';
const PROOF = 'https://w3id.org/security#proof';
const GRAPH_VAR_PREFIX = 'ggggg';  // TBD
const ANONI_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/iri#';
const ANONB_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/bnid#';
const ANONL_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/literal#';
const NANOID_LEN = 6;

type IdentifyCredsResultType = {
  bindings: RDF.Bindings,
  graphIriToBgpTriple: Map<string, TripleForZK[]>,
};

export type TermForZK = SubjectForZK | PredicateForZK | ObjectForZK;
export type SubjectForZK = sparqljs.IriTerm | sparqljs.VariableTerm;
export type PredicateForZK = sparqljs.IriTerm | sparqljs.VariableTerm;
export type ObjectForZK = sparqljs.IriTerm | sparqljs.LiteralTerm | sparqljs.VariableTerm;
export interface TripleForZK {
  subject: SubjectForZK,
  predicate: PredicateForZK,
  object: ObjectForZK,
};

type AnonymizableNonLiteralTerm = sparqljs.IriTerm | sparqljs.BlankTerm;
export const isAnonymizableNonLiteralTerm =
  (t: RDF.Term): t is AnonymizableNonLiteralTerm =>
  (t.termType === 'NamedNode'
    || t.termType === 'BlankNode');
type AnonymizableTerm = sparqljs.IriTerm | sparqljs.BlankTerm | sparqljs.LiteralTerm;
export const isAnonymizableTerm =
  (t: RDF.Term): t is AnonymizableTerm =>
  (t.termType === 'NamedNode'
    || t.termType === 'BlankNode'
    || t.termType === 'Literal');

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

// parse the original SELECT query to get Basic Graph Pattern (BGP)
type ParseQueryResult = {
  parsedQuery: sparqljs.SelectQuery;
  bgpTriples: TripleForZK[];
  whereWithoutBgp: sparqljs.Pattern[] | undefined;
  gVarToBgpTriple: Record<string, TripleForZK>;
} | {
  error: string;
};

export const parseQuery = (query: string): ParseQueryResult => {
  const parser = new sparqljs.Parser();
  let parsedQuery;
  try {
    parsedQuery = parser.parse(query);
    if ((parsedQuery.type !== 'query'
      || parsedQuery.queryType !== 'SELECT')) {
      return { error: 'SELECT query form must be used' };
    }
  } catch (error) {
    return { error: 'malformed query' };
  }

  // validate zkSPARQL query
  const bgpPatterns = parsedQuery.where?.filter((p) => p.type === 'bgp');
  if (bgpPatterns?.length !== 1) {
    return { error: 'WHERE clause must consist of only one basic graph pattern' }
  }
  const bgpPattern = bgpPatterns[0] as sparqljs.BgpPattern;
  const bgpTriples = bgpPattern.triples;
  if (!isTriplesWithoutPropertyPath(bgpTriples)) {
    return { error: 'WHERE clause must consist of only one basic graph pattern' };
  };

  const whereWithoutBgp = parsedQuery.where?.filter((p) => p.type !== 'bgp');
  const gVarToBgpTriple: Record<string, TripleForZK> = Object.assign({}, ...bgpTriples.map((triple, i) => ({
    [`${GRAPH_VAR_PREFIX}${i}`]: triple
  })));

  return { parsedQuery, bgpTriples, whereWithoutBgp, gVarToBgpTriple };
}

export const isTripleWithoutPropertyPath =
  (triple: sparqljs.Triple):
    triple is TripleForZK =>
    'type' in triple.predicate && triple.predicate.type === 'path' ? false : true;

export const isTriplesWithoutPropertyPath =
  (triples: sparqljs.Triple[]):
    triples is TripleForZK[] =>
    triples.map(isTripleWithoutPropertyPath).every(Boolean);

export const genGraphPatterns = (
  bgpTriples: sparqljs.Triple[],
  df: DataFactory<RDF.Quad>
): sparqljs.GraphPattern[] =>
  bgpTriples.map((triple, i) => (
    {
      type: 'graph',
      patterns: [{
        type: 'bgp',
        triples: [triple]
      }],
      name: df.variable(`${GRAPH_VAR_PREFIX}${i}`),
    }
  ));

// identify credentials related to the given query
export const getExtendedBindings = async (
  parsedQuery: sparqljs.SelectQuery,
  graphPatterns: sparqljs.GraphPattern[],
  df: DataFactory<RDF.Quad>,
  engine: Engine
) => {
  // generate a new SELECT query to identify named graphs
  parsedQuery.distinct = true;
  parsedQuery.variables = [new sparqljs.Wildcard()];
  parsedQuery.where = parsedQuery.where?.filter((p) => p.type !== 'bgp').concat(graphPatterns);

  const generator = new sparqljs.Generator();
  const generatedQuery = generator.stringify(parsedQuery);

  // extract identified graphs from the query result
  const bindingsStream = await engine.queryBindings(generatedQuery, { unionDefaultGraph: true });
  const bindingsArray = await streamToArray(bindingsStream);

  return bindingsArray;
};

export const identifyCreds = (
  bindings: RDF.Bindings,
  gVarToBgpTriple: Record<string, TripleForZK>,
): IdentifyCredsResultType => {
  const graphIriAndGraphVars = [...bindings]
    .filter((b) => b[0].value.startsWith(GRAPH_VAR_PREFIX))
    .map(([gVar, gIri]) => [gIri.value, gVar.value]);
  const graphIriAndBgpTriples: [string, TripleForZK][] = graphIriAndGraphVars
    .map(([gIri, gVar]) => [gIri, gVarToBgpTriple[gVar]]);
  const graphIriToBgpTriple = entriesToMap(graphIriAndBgpTriples);
  return ({ bindings, graphIriToBgpTriple });
};

export interface RevealedQuads {
  revealedQuads: RDF.Quad[];
  anonymizedQuads: RDF.Quad[];
};

export interface RevealedCreds {
  revealedQuads: RDF.Quad[];
  anonymizedQuads: RDF.Quad[];
  wholeQuads: RDF.Quad[];
  proofQuadsArray: RDF.Quad[][];
};

export const getRevealedQuads = async (
  graphIriToBgpTriple: Map<string, TripleForZK[]>,
  graphPatterns: sparqljs.Pattern[],
  bindings: RDF.Bindings,
  whereWithoutBgp: sparqljs.Pattern[] | undefined,
  vars: sparqljs.Variable[] | [sparqljs.Wildcard],
  df: DataFactory<RDF.Quad>,
  engine: Engine,
  anonymizer: Anonymizer,
) => {
  const constructQueryObj: sparqljs.ConstructQuery = {
    queryType: 'CONSTRUCT',
    type: 'query',
    prefixes: {},
  };
  const anonymizedQueryObj: sparqljs.ConstructQuery = {
    queryType: 'CONSTRUCT',
    type: 'query',
    prefixes: {},
  };
  constructQueryObj.where = anonymizedQueryObj.where = graphPatterns.concat(whereWithoutBgp ?? []);
  const values: sparqljs.ValuePatternRow = {};
  for (const [v, t] of bindings) {
    if (t.termType !== 'Variable'
      && t.termType !== 'Quad'
      && t.termType !== 'DefaultGraph'
      && t.termType !== 'BlankNode') {
      values[`?${v.value}`] = t;
    }
  }
  constructQueryObj.values = anonymizedQueryObj.values = [values];

  const result = new Map<string, RevealedQuads>();
  for (const [credGraphIri, bgpTriples] of graphIriToBgpTriple.entries()) {
    const generator = new sparqljs.Generator();

    // CONSTRUCT
    constructQueryObj.template = bgpTriples;
    const constructQuery = generator.stringify(constructQueryObj);
    const quadsStream = await engine.queryQuads(constructQuery, { unionDefaultGraph: true });
    const revealedQuads = deduplicateQuads(await streamToArray(quadsStream));

    // CONSTRUCT with anonymized IRIs
    if (isWildcard(vars)) {
      anonymizedQueryObj.template = bgpTriples;
    } else {
      anonymizedQueryObj.template = anonymizeBgpTriples(bgpTriples, vars, bindings, df, anonymizer);
    }
    const anonymizedQuery = generator.stringify(anonymizedQueryObj);
    const anonymizedQuadsStream = await engine.queryQuads(anonymizedQuery, { unionDefaultGraph: true });
    const anonymizedQuads = deduplicateQuads(await streamToArray(anonymizedQuadsStream));

    result.set(credGraphIri, { revealedQuads, anonymizedQuads });
  }
  return result;
};

export const getWholeQuads = async (
  revealedQuads: Map<string, RevealedQuads>,
  store: Quadstore,
  df: DataFactory<RDF.Quad>,
  engine: Engine,
) => {
  const revealedCreds = new Map<string, RevealedCreds>();
  for (const [graphIri, quads] of revealedQuads) {
    const vc = await store.get({
      graph: df.namedNode(graphIri)
    });
    const proofs = await Promise.all(
      (await getProofsId(graphIri, engine)).flatMap(
        async (proofId) => {
          if (proofId == undefined) {
            return [];
          }
          const proof = await store.get({
            graph: df.namedNode(proofId.value)
          });
          return proof.items;
        }));
    revealedCreds.set(graphIri, {
      revealedQuads: quads.revealedQuads,
      anonymizedQuads: quads.anonymizedQuads,
      wholeQuads: vc.items,
      proofQuadsArray: proofs
    });
  }
  return revealedCreds;
}

export class Anonymizer {
  varToAnon: Map<string, sparqljs.IriTerm>;
  varToAnonBlank: Map<string, sparqljs.IriTerm>;
  varToAnonLiteral: Map<string, sparqljs.LiteralTerm>;
  df: DataFactory<RDF.Quad>;

  constructor(df: DataFactory<RDF.Quad>) {
    this.varToAnon = new Map<string, sparqljs.IriTerm>();
    this.varToAnonBlank = new Map<string, sparqljs.IriTerm>();
    this.varToAnonLiteral = new Map<string, sparqljs.LiteralTerm>();
    this.df = df;
  }

  private _genKey = (varName: string, val: AnonymizableTerm) =>
    val.termType === 'Literal' ?
      `${varName}:${val.termType}:${val.value}:${nanoid(NANOID_LEN)}` :
      `${varName}:${val.termType}:${val.value}`;

  anonymize = (varName: string, val: AnonymizableNonLiteralTerm) => {
    const key = this._genKey(varName, val);
    let anon: sparqljs.IriTerm;
    if (val.termType === 'NamedNode') {
      const result = this.varToAnon.get(key);
      if (result != undefined) {
        return result;
      }
      anon = this.df.namedNode(
        `${ANONI_PREFIX}${nanoid(NANOID_LEN)}`) as sparqljs.IriTerm;
      this.varToAnon.set(key, anon);
    } else {
      const result = this.varToAnonBlank.get(key);
      if (result != undefined) {
        return result;
      }
      anon = this.df.namedNode(
        `${ANONB_PREFIX}${nanoid(NANOID_LEN)}`) as sparqljs.IriTerm;
      this.varToAnonBlank.set(key, anon);
    }
    return anon;
  };

  anonymizeObject = (varName: string, val: AnonymizableTerm) => {
    const key = this._genKey(varName, val);
    let anon: sparqljs.IriTerm | sparqljs.LiteralTerm;
    if (val.termType === 'NamedNode' || val.termType === 'BlankNode') {
      return this.anonymize(varName, val);
    } else {
      const result = this.varToAnonLiteral.get(key);
      if (result != undefined) {
        return result;
      }
      if (val.language !== '') {
        anon = this.df.literal(
          `${ANONL_PREFIX}${nanoid(NANOID_LEN)}`,
          val.language
        ) as sparqljs.LiteralTerm;
        this.varToAnonLiteral.set(key, anon);
      } else {
        anon = this.df.literal(
          `${ANONL_PREFIX}${nanoid(NANOID_LEN)}`,
          val.datatype
        ) as sparqljs.LiteralTerm;
        this.varToAnonLiteral.set(key, anon);
      }
    }
    return anon;
  }
}

const anonymizeBgpTriples = (
  bgpTriples: TripleForZK[],
  vars: sparqljs.Variable[],
  bindings: RDF.Bindings,
  df: DataFactory<RDF.Quad>,
  anonymizer: Anonymizer,
): TripleForZK[] => bgpTriples.map(
  (triple): TripleForZK => {
    const varNames = vars.map((v) =>
      'expression' in v ? v.variable.value : v.value);

    const _anonymize = (term: SubjectForZK | PredicateForZK) => {
      if (term.termType === 'Variable' && !varNames.includes(term.value)) {
        const val = bindings.get(term);
        if (val != undefined && isAnonymizableNonLiteralTerm(val)) {
          return anonymizer.anonymize(term.value, val);
        } else {
          return df.fromTerm(term);  // TBD
        }
      } else {
        return df.fromTerm(term);
      }
    }
    const subject = _anonymize(triple.subject);
    const predicate = _anonymize(triple.predicate);

    const _anonymizeObject = (term: ObjectForZK) => {
      if (term.termType === 'Variable' && !varNames.includes(term.value)) {
        const val = bindings.get(term);
        if (val != undefined && isAnonymizableTerm(val)) {
          return anonymizer.anonymizeObject(term.value, val);
        } else {
          return df.fromTerm(term);  // TBD
        }
      } else {
        return df.fromTerm(term);
      }
    }
    const object = _anonymizeObject(triple.object);

    return {
      subject, predicate, object
    };
  }
);

export const getProofsId = async (
  graphIri: string,
  engine: Engine
) => {
  const query = `
  SELECT ?proof
  WHERE {
    GRAPH <${graphIri}> {
      ?c a <${VC_TYPE}> ;
        <${PROOF}> ?proof .
    }
  }`;
  const bindingsStream = await engine.queryBindings(query);  // TBD: try-catch
  const bindingsArray = await streamToArray(bindingsStream);
  return bindingsArray.map((bindings) => bindings.get('proof'));
};

export const deduplicateQuads = (quads: RDF.Quad[]) =>
  quads.filter((quad1, index, self) =>
    index === self.findIndex((quad2) => (quad1.equals(quad2))));

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
