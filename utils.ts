import { DataFactory } from 'rdf-data-factory';
import { Engine } from 'quadstore-comunica';
import * as RDF from '@rdfjs/types';
import sparqljs from 'sparqljs';
import { nanoid } from 'nanoid';
import { Quadstore } from 'quadstore';

// ** constants ** //

export const VC_TYPE = 'https://www.w3.org/2018/credentials#VerifiableCredential';
export const PROOF = 'https://w3id.org/security#proof';
const GRAPH_VAR_PREFIX = 'ggggg';  // TBD
export const ANON_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/';
const ANONI_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/iri#';
const ANONB_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/bnid#';
const ANONL_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/literal#';
const NANOID_LEN = 6;
const BNODE_PREFIX = '_:';

// ** types ** //

export type ZkTermBgp = ZkSubjectBgp | ZkPredicateBgp | ZkObjectBgp;
export type ZkSubjectBgp = sparqljs.IriTerm | sparqljs.VariableTerm;
export type ZkPredicateBgp = sparqljs.IriTerm | sparqljs.VariableTerm;
export type ZkObjectBgp = sparqljs.IriTerm | sparqljs.LiteralTerm | sparqljs.VariableTerm;
export interface ZkTripleBgp {
  subject: ZkSubjectBgp,
  predicate: ZkPredicateBgp,
  object: ZkObjectBgp,
};

type ZkTerm = ZkSubject | ZkPredicate | ZkObject;
type ZkSubject = sparqljs.IriTerm | sparqljs.BlankTerm;
export const isZkSubject =
  (t: RDF.Term): t is ZkSubject =>
  (t.termType === 'NamedNode'
    || t.termType === 'BlankNode');
type ZkPredicate = sparqljs.IriTerm;
export const isZkPredicate =
  (t: RDF.Term): t is ZkPredicate =>
    t.termType === 'NamedNode';
type ZkObject = sparqljs.IriTerm | sparqljs.BlankTerm | sparqljs.LiteralTerm;
export const isZkObject =
  (t: RDF.Term): t is ZkObject =>
  (t.termType === 'NamedNode'
    || t.termType === 'BlankNode'
    || t.termType === 'Literal');

type IdentifyCredsResultType = {
  bindings: RDF.Bindings,
  graphIriToBgpTriple: Map<string, ZkTripleBgp[]>,
};

type ParseQueryResult = {
  parsedQuery: sparqljs.SelectQuery;
  bgpTriples: ZkTripleBgp[];
  gVarToBgpTriple: Record<string, ZkTripleBgp>;
} | {
  error: string;
};

export interface RevealedQuads {
  revealedQuads: RDF.Quad[];
  anonymizedQuads: RDF.Quad[];
};

export interface RevealedCreds {
  wholeDoc: RDF.Quad[];
  revealedDoc: RDF.Quad[];
  anonymizedDoc: RDF.Quad[];
  proofs: RDF.Quad[][];
};

// ** functions ** //

export const isVariableTerm =
  (v: sparqljs.Variable): v is sparqljs.VariableTerm =>
    !('expression' in v);
export const isVariableTerms =
  (vs: sparqljs.Variable[]): vs is sparqljs.VariableTerm[] =>
    vs.every((v) => isVariableTerm(v));

export const extractVars =
  (query: string):
    sparqljs.VariableTerm[] |
    [sparqljs.Wildcard] |
    { error: string } => {
    const parser = new sparqljs.Parser();
    try {
      const parsedQuery = parser.parse(query);
      if (!(parsedQuery.type === 'query'
        && parsedQuery.queryType === 'SELECT')) {
        return { error: 'query must be SELECT form' };
      }
      if (isWildcard(parsedQuery.variables)
        || (isVariableTerms(parsedQuery.variables))) {
        return parsedQuery.variables;
      } else {
        return { error: 'query must not contain term expressions' }
      }
    } catch (error) {
      return { error: 'malformed query' };
    }
  }

// parse the original SELECT query to get Basic Graph Pattern (BGP)
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

  // validate zk-SPARQL query
  const bgpPatterns = parsedQuery.where?.filter((p) => p.type === 'bgp');
  if (bgpPatterns?.length !== 1) {
    return { error: 'WHERE clause must consist of only one basic graph pattern' }
  }
  const bgpPattern = bgpPatterns[0] as sparqljs.BgpPattern;
  const bgpTriples = bgpPattern.triples;
  if (!isTriplesWithoutPropertyPath(bgpTriples)) {
    return { error: 'property paths are not supported' };
  };

  const gVarToBgpTriple: Record<string, ZkTripleBgp> = Object.assign({}, ...bgpTriples.map((triple, i) => ({
    [`${GRAPH_VAR_PREFIX}${i}`]: triple
  })));

  return { parsedQuery, bgpTriples, gVarToBgpTriple };
}

export const isTripleWithoutPropertyPath =
  (triple: sparqljs.Triple):
    triple is ZkTripleBgp =>
    'type' in triple.predicate && triple.predicate.type === 'path' ? false : true;

export const isTriplesWithoutPropertyPath =
  (triples: sparqljs.Triple[]):
    triples is ZkTripleBgp[] =>
    triples.map(isTripleWithoutPropertyPath).every(Boolean);

// identify credentials related to the given query
export const getExtendedBindings = async (
  bgpTriples: sparqljs.Triple[],
  parsedQuery: sparqljs.SelectQuery,
  df: DataFactory<RDF.Quad>,
  engine: Engine
) => {
  // generate graph patterns
  const graphPatterns: sparqljs.GraphPattern[]
    = bgpTriples.map((triple, i) => (
      {
        type: 'graph',
        patterns: [{
          type: 'bgp',
          triples: [triple]
        }],
        name: df.variable(`${GRAPH_VAR_PREFIX}${i}`),
      }
    ));

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
  gVarToBgpTriple: Record<string, ZkTripleBgp>,
): IdentifyCredsResultType => {
  const graphIriAndGraphVars = [...bindings]
    .filter((b) => b[0].value.startsWith(GRAPH_VAR_PREFIX))
    .map(([gVar, gIri]) => [gIri.value, gVar.value]);
  const graphIriAndBgpTriples: [string, ZkTripleBgp][] = graphIriAndGraphVars
    .map(([gIri, gVar]) => [gIri, gVarToBgpTriple[gVar]]);
  const graphIriToBgpTriple = entriesToMap(graphIriAndBgpTriples);
  return ({ bindings, graphIriToBgpTriple });
};

export const getRevealedQuads = async (
  graphIriToBgpTriple: Map<string, ZkTripleBgp[]>,
  bindings: RDF.Bindings,
  vars: sparqljs.VariableTerm[] | [sparqljs.Wildcard],
  df: DataFactory<RDF.Quad>,
  anonymizer: Anonymizer,
) => {
  const result = new Map<string, RevealedQuads>();
  for (const [credGraphIri, bgpTriples] of graphIriToBgpTriple.entries()) {
    const revealedQuads = bgpTriples.flatMap((triple) => {
      const subject = triple.subject.termType === 'Variable'
        ? bindings.get(triple.subject) : triple.subject;
      const predicate = triple.predicate.termType === 'Variable'
        ? bindings.get(triple.predicate) : triple.predicate;
      const object = triple.object.termType === 'Variable'
        ? bindings.get(triple.object) : triple.object;
      const graph = df.defaultGraph()
      if (subject != undefined && isZkSubject(subject)
        && predicate != undefined && isZkPredicate(predicate)
        && object != undefined && isZkObject(object)) {
        return [df.quad(subject, predicate, object, graph)];
      } else {
        return [];
      }
    });
    const anonymizedQuads = isWildcard(vars)
      ? revealedQuads.map((quad) => df.fromQuad(quad)) // deep copy
      : anonymizeQuad(bgpTriples, vars, bindings, df, anonymizer);
    result.set(credGraphIri, { revealedQuads, anonymizedQuads });
  }
  return result;
};

export const getDocsAndProofs = async (
  revealedQuads: Map<string, RevealedQuads>,
  store: Quadstore,
  df: DataFactory<RDF.Quad>,
  engine: Engine,
  anonymizer: Anonymizer,
) => {
  const revealedCreds = new Map<string, RevealedCreds>();
  for (const [graphIri, quads] of revealedQuads) {
    // get whole creds
    const vc = await store.get({
      graph: df.namedNode(graphIri)
    });
    // remove graph name
    const wholeDoc = vc.items
      .map((quad) => df.quad(quad.subject, quad.predicate, quad.object));

    // get associated proofs
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

    // get revealed credential by addding metadata to revealed quads
    const metadata = await getCredentialMetadata(graphIri, df, store, engine)
      ?? [];
    const revealedDoc = quads.revealedQuads.concat(metadata);

    // get anonymized credential by addding metadata to anonymized quads
    const anonymizedMetadata = metadata.map((quad) => {
      const subject = isZkSubject(quad.subject) ?
        anonymizer.get(quad.subject) : quad.subject;
      const predicate = isZkPredicate(quad.predicate) ?
        anonymizer.get(quad.predicate) : quad.predicate;
      const object = isZkObject(quad.object) ?
        anonymizer.getObject(quad.object) : quad.object;
      return df.quad(
        subject != undefined ? subject : quad.subject,
        predicate != undefined ? predicate : quad.predicate,
        object != undefined ? object : quad.object,
        df.defaultGraph(),
      );
    });
    const anonymizedDoc =
      metadata == undefined ? quads.anonymizedQuads
        : quads.anonymizedQuads.concat(anonymizedMetadata);

    revealedCreds.set(graphIri, {
      wholeDoc,
      revealedDoc,
      anonymizedDoc,
      proofs,
    });
  }
  return revealedCreds;
}

export class Anonymizer {
  iriToAnonMap: Map<string, sparqljs.IriTerm>;
  bnodeToAnonMap: Map<string, sparqljs.IriTerm>;
  literalToAnonMap: Map<string, sparqljs.LiteralTerm>;
  anonToTerm: Map<string, ZkTerm>;
  df: DataFactory<RDF.Quad>;

  constructor(df: DataFactory<RDF.Quad>) {
    this.iriToAnonMap = new Map<string, sparqljs.IriTerm>();
    this.bnodeToAnonMap = new Map<string, sparqljs.IriTerm>();
    this.literalToAnonMap = new Map<string, sparqljs.LiteralTerm>();
    this.anonToTerm = new Map<string, ZkTerm>();
    this.df = df;
  }

  private _genKey = (val: ZkTerm) =>
    val.termType === 'Literal' ?
      `${val.value}:${nanoid(NANOID_LEN)}` :
      `${val.value}`;

  anonymize = (val: ZkSubject | ZkPredicate) => {
    const key = this._genKey(val);
    let anon: sparqljs.IriTerm;
    if (val.termType === 'NamedNode') {
      const result = this.iriToAnonMap.get(key);
      if (result != undefined) {
        return result;
      }
      const anonIri = `${ANONI_PREFIX}${nanoid(NANOID_LEN)}`;
      anon = this.df.namedNode(anonIri) as sparqljs.IriTerm;
      this.iriToAnonMap.set(key, anon);
      this.anonToTerm.set(anonIri, val);
    } else {
      const result = this.bnodeToAnonMap.get(key);
      if (result != undefined) {
        return result;
      }
      const anonBnid = `${ANONB_PREFIX}${nanoid(NANOID_LEN)}`;
      anon = this.df.namedNode(anonBnid) as sparqljs.IriTerm;
      this.bnodeToAnonMap.set(key, anon);
      this.anonToTerm.set(anonBnid, val);
    }
    return anon;
  };

  get = (val: ZkSubject | ZkPredicate) => {
    const key = this._genKey(val);
    if (val.termType === 'NamedNode') {
      return this.iriToAnonMap.get(key);
    } else {
      return this.bnodeToAnonMap.get(key);
    }
  };

  anonymizeObject = (val: ZkObject) => {
    if (val.termType === 'NamedNode' || val.termType === 'BlankNode') {
      return this.anonymize(val);
    }
    const key = this._genKey(val);
    const result = this.literalToAnonMap.get(key);
    if (result != undefined) {
      return result;
    }
    const anonLiteral = `${ANONL_PREFIX}${nanoid(NANOID_LEN)}`;
    const languageOrDatatype = val.language !== '' ? val.language : val.datatype;
    const anon = this.df.literal(anonLiteral, languageOrDatatype) as sparqljs.LiteralTerm;
    this.literalToAnonMap.set(key, anon);
    this.anonToTerm.set(anonLiteral, val);
    return anon;
  };

  getObject = (val: ZkObject) => {
    const key = this._genKey(val);
    if (val.termType === 'NamedNode' || val.termType === 'BlankNode') {
      return this.get(val);
    } else {
      return this.literalToAnonMap.get(key);
    }
  };
}

const anonymizeQuad = (
  bgpTriples: ZkTripleBgp[],
  vars: sparqljs.VariableTerm[],
  bindings: RDF.Bindings,
  df: DataFactory<RDF.Quad>,
  anonymizer: Anonymizer,
) => bgpTriples.flatMap(
  (triple) => {
    let subject: RDF.Term | undefined;
    if (triple.subject.termType !== 'Variable') {
      subject = triple.subject;
    } else if (vars.some((v) => v.value === triple.subject.value)) {
      subject = bindings.get(triple.subject);
    } else {
      const val = bindings.get(triple.subject);
      if (val != undefined && isZkSubject(val)) {
        subject = anonymizer.anonymize(val);
      }
    }

    let predicate: RDF.Term | undefined;
    if (triple.predicate.termType !== 'Variable') {
      predicate = triple.predicate;
    } else if (vars.some((v) => v.value === triple.predicate.value)) {
      predicate = bindings.get(triple.predicate);
    } else {
      const val = bindings.get(triple.predicate);
      if (val != undefined && isZkPredicate(val)) {
        predicate = anonymizer.anonymize(val);
      }
    }

    let object: RDF.Term | undefined;
    if (triple.object.termType !== 'Variable') {
      object = triple.object;
    } else if (vars.some((v) => v.value === triple.object.value)) {
      object = bindings.get(triple.object);
    } else {
      const val = bindings.get(triple.object);
      if (val != undefined && isZkObject(val)) {
        object = anonymizer.anonymizeObject(val);
      }
    }

    const graph = df.defaultGraph();

    if (subject != undefined && isZkSubject(subject)
      && predicate != undefined && isZkPredicate(predicate)
      && object != undefined && isZkObject(object)) {
      return [df.quad(subject, predicate, object, graph)];
    } else {
      return []
    }
  }
);

export const getCredentialMetadata = async (
  graphIri: string,
  df: DataFactory,
  store: Quadstore,
  engine: Engine,
) => {
  const query = `
  SELECT ?cred
  WHERE {
    GRAPH <${graphIri}> {
      ?cred a <${VC_TYPE}> .
    }
  }`;
  const bindingsStream = await engine.queryBindings(query);  // TBD: try-catch
  const bindingsArray = await streamToArray(bindingsStream);
  const credIds = bindingsArray.map((bindings) => bindings.get('cred'));
  if (credIds.length === 0) {
    return undefined;
  }
  const credId = credIds[0];
  if (credId == undefined
    || (credId.termType !== 'NamedNode'
      && credId.termType !== 'BlankNode')) {
    return undefined;
  }
  const { items } = await store.get({ subject: credId });
  // remove graph name
  const cred = items.map(
    (quad) => df.quad(
      quad.subject,
      quad.predicate,
      quad.object,
      df.defaultGraph()));
  return cred;
};

export const getProofsId = async (
  graphIri: string,
  engine: Engine
) => {
  const query = `
  SELECT ?proof
  WHERE {
    GRAPH <${graphIri}> {
      ?cred a <${VC_TYPE}> ;
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

export const addBnodePrefix = (quad: RDF.Quad | RDF.Quad[]) => {
  const _addBnodePrefix = (quad: RDF.Quad) => {
    if (quad.subject.termType === 'BlankNode'
      && !quad.subject.value.startsWith(BNODE_PREFIX)) {
      quad.subject.value = `${BNODE_PREFIX}${quad.subject.value}`;
    }
    if (quad.object.termType === 'BlankNode'
      && !quad.object.value.startsWith(BNODE_PREFIX)) {
      quad.object.value = `${BNODE_PREFIX}${quad.object.value}`;
    }
    if (quad.graph.termType === 'BlankNode'
      && !quad.graph.value.startsWith(BNODE_PREFIX)) {
      quad.graph.value = `${BNODE_PREFIX}${quad.graph.value}`;
    }
    return quad;
  }

  return Array.isArray(quad) ? quad.map((q) => _addBnodePrefix(q)) : _addBnodePrefix(quad);
}
