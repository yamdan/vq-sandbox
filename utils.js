import sparqljs from 'sparqljs';
import { nanoid } from 'nanoid';
// ** constants ** //
export const VC_TYPE = 'https://www.w3.org/2018/credentials#VerifiableCredential';
export const PROOF = 'https://w3id.org/security#proof';
const GRAPH_VAR_PREFIX = 'ggggg'; // TBD
export const ANON_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/';
const ANONI_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/iri#';
const ANONB_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/bnid#';
const ANONL_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/literal#';
const NANOID_LEN = 6;
const BNODE_PREFIX = '_:';
;
export const isZkSubject = (t) => (t.termType === 'NamedNode'
    || t.termType === 'BlankNode');
export const isZkPredicate = (t) => t.termType === 'NamedNode';
export const isZkObject = (t) => (t.termType === 'NamedNode'
    || t.termType === 'BlankNode'
    || t.termType === 'Literal');
;
;
// ** functions ** //
export const isVariableTerm = (v) => !('expression' in v);
export const isVariableTerms = (vs) => vs.every((v) => isVariableTerm(v));
export const extractVars = (query) => {
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
        }
        else {
            return { error: 'query must not contain term expressions' };
        }
    }
    catch (error) {
        return { error: 'malformed query' };
    }
};
// parse the original SELECT query to get Basic Graph Pattern (BGP)
export const parseQuery = (query) => {
    var _a;
    const parser = new sparqljs.Parser();
    let parsedQuery;
    try {
        parsedQuery = parser.parse(query);
        if ((parsedQuery.type !== 'query'
            || parsedQuery.queryType !== 'SELECT')) {
            return { error: 'SELECT query form must be used' };
        }
    }
    catch (error) {
        return { error: 'malformed query' };
    }
    // validate zk-SPARQL query
    const bgpPatterns = (_a = parsedQuery.where) === null || _a === void 0 ? void 0 : _a.filter((p) => p.type === 'bgp');
    if ((bgpPatterns === null || bgpPatterns === void 0 ? void 0 : bgpPatterns.length) !== 1) {
        return { error: 'WHERE clause must consist of only one basic graph pattern' };
    }
    const bgpPattern = bgpPatterns[0];
    const bgpTriples = bgpPattern.triples;
    if (!isTriplesWithoutPropertyPath(bgpTriples)) {
        return { error: 'property paths are not supported' };
    }
    ;
    const gVarToBgpTriple = Object.assign({}, ...bgpTriples.map((triple, i) => ({
        [`${GRAPH_VAR_PREFIX}${i}`]: triple
    })));
    return { parsedQuery, bgpTriples, gVarToBgpTriple };
};
export const isTripleWithoutPropertyPath = (triple) => 'type' in triple.predicate && triple.predicate.type === 'path' ? false : true;
export const isTriplesWithoutPropertyPath = (triples) => triples.map(isTripleWithoutPropertyPath).every(Boolean);
// identify credentials related to the given query
export const getExtendedBindings = async (bgpTriples, parsedQuery, df, engine) => {
    var _a;
    // generate graph patterns
    const graphPatterns = bgpTriples.map((triple, i) => ({
        type: 'graph',
        patterns: [{
                type: 'bgp',
                triples: [triple]
            }],
        name: df.variable(`${GRAPH_VAR_PREFIX}${i}`),
    }));
    // generate a new SELECT query to identify named graphs
    parsedQuery.distinct = true;
    parsedQuery.variables = [new sparqljs.Wildcard()];
    parsedQuery.where = (_a = parsedQuery.where) === null || _a === void 0 ? void 0 : _a.filter((p) => p.type !== 'bgp').concat(graphPatterns);
    const generator = new sparqljs.Generator();
    const generatedQuery = generator.stringify(parsedQuery);
    // extract identified graphs from the query result
    const bindingsStream = await engine.queryBindings(generatedQuery, { unionDefaultGraph: true });
    const bindingsArray = await streamToArray(bindingsStream);
    return bindingsArray;
};
export const identifyCreds = (bindings, gVarToBgpTriple) => {
    const graphIriAndGraphVars = [...bindings]
        .filter((b) => b[0].value.startsWith(GRAPH_VAR_PREFIX))
        .map(([gVar, gIri]) => [gIri.value, gVar.value]);
    const graphIriAndBgpTriples = graphIriAndGraphVars
        .map(([gIri, gVar]) => [gIri, gVarToBgpTriple[gVar]]);
    const graphIriToBgpTriple = entriesToMap(graphIriAndBgpTriples);
    return ({ bindings, graphIriToBgpTriple });
};
export const getRevealedQuads = async (graphIriToBgpTriple, bindings, vars, df, anonymizer) => {
    const result = new Map();
    for (const [credGraphIri, bgpTriples] of graphIriToBgpTriple.entries()) {
        const revealedQuads = bgpTriples.flatMap((triple) => {
            const subject = triple.subject.termType === 'Variable'
                ? bindings.get(triple.subject) : triple.subject;
            const predicate = triple.predicate.termType === 'Variable'
                ? bindings.get(triple.predicate) : triple.predicate;
            const object = triple.object.termType === 'Variable'
                ? bindings.get(triple.object) : triple.object;
            const graph = df.defaultGraph();
            if (subject != undefined && isZkSubject(subject)
                && predicate != undefined && isZkPredicate(predicate)
                && object != undefined && isZkObject(object)) {
                return [df.quad(subject, predicate, object, graph)];
            }
            else {
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
export const getDocsAndProofs = async (revealedQuads, store, df, engine, anonymizer) => {
    var _a;
    const revealedCreds = new Map();
    for (const [graphIri, quads] of revealedQuads) {
        // get whole creds
        const vc = await store.get({
            graph: df.namedNode(graphIri)
        });
        // remove graph name
        const wholeDoc = vc.items
            .map((quad) => df.quad(quad.subject, quad.predicate, quad.object));
        // get associated proofs
        const proofs = await Promise.all((await getProofsId(graphIri, engine)).flatMap(async (proofId) => {
            if (proofId == undefined) {
                return [];
            }
            const proof = await store.get({
                graph: df.namedNode(proofId.value)
            });
            return proof.items;
        }));
        // get revealed credential by addding metadata to revealed quads
        const metadata = (_a = await getCredentialMetadata(graphIri, df, store, engine)) !== null && _a !== void 0 ? _a : [];
        const revealedDoc = quads.revealedQuads.concat(metadata);
        // get anonymized credential by addding metadata to anonymized quads
        const anonymizedMetadata = metadata.map((quad) => {
            const subject = isZkSubject(quad.subject) ?
                anonymizer.get(quad.subject) : quad.subject;
            const predicate = isZkPredicate(quad.predicate) ?
                anonymizer.get(quad.predicate) : quad.predicate;
            const object = isZkObject(quad.object) ?
                anonymizer.getObject(quad.object) : quad.object;
            return df.quad(subject != undefined ? subject : quad.subject, predicate != undefined ? predicate : quad.predicate, object != undefined ? object : quad.object, df.defaultGraph());
        });
        const anonymizedDoc = metadata == undefined ? quads.anonymizedQuads
            : quads.anonymizedQuads.concat(anonymizedMetadata);
        revealedCreds.set(graphIri, {
            wholeDoc,
            revealedDoc,
            anonymizedDoc,
            proofs,
        });
    }
    return revealedCreds;
};
export class Anonymizer {
    constructor(df) {
        this._genKey = (val) => val.termType === 'Literal' ?
            `${val.value}:${nanoid(NANOID_LEN)}` :
            `${val.value}`;
        this.anonymize = (val) => {
            const key = this._genKey(val);
            let anon;
            if (val.termType === 'NamedNode') {
                const result = this.iriToAnonMap.get(key);
                if (result != undefined) {
                    return result;
                }
                const anonIri = `${ANONI_PREFIX}${nanoid(NANOID_LEN)}`;
                anon = this.df.namedNode(anonIri);
                this.iriToAnonMap.set(key, anon);
                this.anonToTerm.set(anonIri, val);
            }
            else {
                const result = this.bnodeToAnonMap.get(key);
                if (result != undefined) {
                    return result;
                }
                const anonBnid = `${ANONB_PREFIX}${nanoid(NANOID_LEN)}`;
                anon = this.df.namedNode(anonBnid);
                this.bnodeToAnonMap.set(key, anon);
                this.anonToTerm.set(anonBnid, val);
            }
            return anon;
        };
        this.get = (val) => {
            const key = this._genKey(val);
            if (val.termType === 'NamedNode') {
                return this.iriToAnonMap.get(key);
            }
            else {
                return this.bnodeToAnonMap.get(key);
            }
        };
        this.anonymizeObject = (val) => {
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
            const anon = this.df.literal(anonLiteral, languageOrDatatype);
            this.literalToAnonMap.set(key, anon);
            this.anonToTerm.set(anonLiteral, val);
            return anon;
        };
        this.getObject = (val) => {
            const key = this._genKey(val);
            if (val.termType === 'NamedNode' || val.termType === 'BlankNode') {
                return this.get(val);
            }
            else {
                return this.literalToAnonMap.get(key);
            }
        };
        this.iriToAnonMap = new Map();
        this.bnodeToAnonMap = new Map();
        this.literalToAnonMap = new Map();
        this.anonToTerm = new Map();
        this.df = df;
    }
}
const anonymizeQuad = (bgpTriples, vars, bindings, df, anonymizer) => bgpTriples.flatMap((triple) => {
    let subject;
    if (triple.subject.termType !== 'Variable') {
        subject = triple.subject;
    }
    else if (vars.some((v) => v.value === triple.subject.value)) {
        subject = bindings.get(triple.subject);
    }
    else {
        const val = bindings.get(triple.subject);
        if (val != undefined && isZkSubject(val)) {
            subject = anonymizer.anonymize(val);
        }
    }
    let predicate;
    if (triple.predicate.termType !== 'Variable') {
        predicate = triple.predicate;
    }
    else if (vars.some((v) => v.value === triple.predicate.value)) {
        predicate = bindings.get(triple.predicate);
    }
    else {
        const val = bindings.get(triple.predicate);
        if (val != undefined && isZkPredicate(val)) {
            predicate = anonymizer.anonymize(val);
        }
    }
    let object;
    if (triple.object.termType !== 'Variable') {
        object = triple.object;
    }
    else if (vars.some((v) => v.value === triple.object.value)) {
        object = bindings.get(triple.object);
    }
    else {
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
    }
    else {
        return [];
    }
});
export const getCredentialMetadata = async (graphIri, df, store, engine) => {
    const query = `
  SELECT ?cred
  WHERE {
    GRAPH <${graphIri}> {
      ?cred a <${VC_TYPE}> .
    }
  }`;
    const bindingsStream = await engine.queryBindings(query); // TBD: try-catch
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
    const cred = items.map((quad) => df.quad(quad.subject, quad.predicate, quad.object, df.defaultGraph()));
    return cred;
};
export const getProofsId = async (graphIri, engine) => {
    const query = `
  SELECT ?proof
  WHERE {
    GRAPH <${graphIri}> {
      ?cred a <${VC_TYPE}> ;
        <${PROOF}> ?proof .
    }
  }`;
    const bindingsStream = await engine.queryBindings(query); // TBD: try-catch
    const bindingsArray = await streamToArray(bindingsStream);
    return bindingsArray.map((bindings) => bindings.get('proof'));
};
export const deduplicateQuads = (quads) => quads.filter((quad1, index, self) => index === self.findIndex((quad2) => (quad1.equals(quad2))));
// utility function from [string, T][] to Map<string, T[]>
export const entriesToMap = (entries) => {
    var _a;
    const res = new Map();
    for (const entry of entries) {
        if (res.has(entry[0])) {
            (_a = res.get(entry[0])) === null || _a === void 0 ? void 0 : _a.push(entry[1]);
        }
        else {
            res.set(entry[0], [entry[1]]);
        }
        ;
    }
    ;
    return res;
};
// ref: https://github.com/belayeng/quadstore-comunica/blob/master/spec/src/utils.ts
export const streamToArray = (source) => {
    return new Promise((resolve, reject) => {
        const items = [];
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
export const genJsonResults = (jsonVars, bindingsArray) => {
    const isNotNullOrUndefined = (v) => null != v;
    const jsonBindingsArray = [];
    for (const bindings of bindingsArray) {
        const jsonBindingsEntries = [...bindings].map(([k, v]) => {
            let value;
            if (v.termType === 'Literal') {
                if (v.language !== '') {
                    value = {
                        type: 'literal',
                        value: v.value,
                        'xml:lang': v.language
                    };
                }
                else if (v.datatype.value === 'http://www.w3.org/2001/XMLSchema#string') {
                    value = {
                        type: 'literal',
                        value: v.value
                    };
                }
                else {
                    value = {
                        type: 'literal',
                        value: v.value,
                        datatype: v.datatype.value
                    };
                }
            }
            else if (v.termType === 'NamedNode') {
                value = {
                    type: 'uri',
                    value: v.value
                };
            }
            else if (v.termType === 'BlankNode') {
                value = {
                    type: 'bnode',
                    value: v.value
                };
            }
            else {
                return undefined;
            }
            ;
            return [k.value, value];
        }).filter(isNotNullOrUndefined);
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
};
export const isWildcard = (vars) => vars.length === 1 && 'value' in vars[0] && vars[0].value === '*';
export const addBnodePrefix = (quad) => {
    const _addBnodePrefix = (quad) => {
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
    };
    return Array.isArray(quad) ? quad.map((q) => _addBnodePrefix(q)) : _addBnodePrefix(quad);
};
