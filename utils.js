import sparqljs from 'sparqljs';
import { nanoid } from 'nanoid';
// Constants
const GRAPH_VAR_PREFIX = 'ggggg'; // TBD
const ANONI_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/iri#';
const ANONB_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/bnode#';
const ANONL_PREFIX = 'https://zkp-ld.org/.well-known/genid/anonymous/literal#';
const NANOID_LEN = 6;
;
export const isAnonymizableNonLiteralTerm = (t) => (t.termType === 'NamedNode'
    || t.termType === 'BlankNode');
export const isAnonymizableTerm = (t) => (t.termType === 'NamedNode'
    || t.termType === 'BlankNode'
    || t.termType === 'Literal');
export const extractVars = (query) => {
    const parser = new sparqljs.Parser();
    try {
        const parsedQuery = parser.parse(query);
        if (!(parsedQuery.type === 'query' && parsedQuery.queryType === 'SELECT')) {
            return undefined;
        }
        return parsedQuery.variables;
    }
    catch (error) {
        return undefined;
    }
};
export const parseQuery = (query) => {
    var _a, _b;
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
    // validate zkSPARQL query
    const bgpPatterns = (_a = parsedQuery.where) === null || _a === void 0 ? void 0 : _a.filter((p) => p.type === 'bgp');
    if ((bgpPatterns === null || bgpPatterns === void 0 ? void 0 : bgpPatterns.length) !== 1) {
        return { error: 'WHERE clause must consist of only one basic graph pattern' };
    }
    const bgpPattern = bgpPatterns[0];
    const bgpTriples = bgpPattern.triples;
    if (!isTriplesWithoutPropertyPath(bgpTriples)) {
        return { error: 'WHERE clause must consist of only one basic graph pattern' };
    }
    ;
    const whereWithoutBgp = (_b = parsedQuery.where) === null || _b === void 0 ? void 0 : _b.filter((p) => p.type !== 'bgp');
    const gVarToBgpTriple = Object.assign({}, ...bgpTriples.map((triple, i) => ({
        [`${GRAPH_VAR_PREFIX}${i}`]: triple
    })));
    return { parsedQuery, bgpTriples, whereWithoutBgp, gVarToBgpTriple };
};
export const isTripleWithoutPropertyPath = (triple) => 'type' in triple.predicate && triple.predicate.type === 'path' ? false : true;
export const isTriplesWithoutPropertyPath = (triples) => triples.map(isTripleWithoutPropertyPath).every(Boolean);
export const genGraphPatterns = (bgpTriples, df) => bgpTriples.map((triple, i) => ({
    type: 'graph',
    patterns: [{
            type: 'bgp',
            triples: [triple]
        }],
    name: df.variable(`${GRAPH_VAR_PREFIX}${i}`),
}));
// identify credentials related to the given query
export const getExtendedBindings = async (parsedQuery, graphPatterns, df, engine) => {
    var _a;
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
export const getRevealedQuads = async (graphIriToBgpTriple, graphPatterns, bindings, whereWithoutBgp, vars, df, engine, anonymizer) => {
    const constructQueryObj = {
        queryType: 'CONSTRUCT',
        type: 'query',
        prefixes: {},
    };
    const anonymizedQueryObj = {
        queryType: 'CONSTRUCT',
        type: 'query',
        prefixes: {},
    };
    constructQueryObj.where = anonymizedQueryObj.where = graphPatterns.concat(whereWithoutBgp !== null && whereWithoutBgp !== void 0 ? whereWithoutBgp : []);
    const values = {};
    for (const [v, t] of bindings) {
        if (t.termType !== 'Variable'
            && t.termType !== 'Quad'
            && t.termType !== 'DefaultGraph'
            && t.termType !== 'BlankNode') {
            values[`?${v.value}`] = t;
        }
    }
    constructQueryObj.values = anonymizedQueryObj.values = [values];
    const result = new Map();
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
        }
        else {
            anonymizedQueryObj.template = anonymizeBgpTriples(bgpTriples, vars, bindings, df, anonymizer);
        }
        const anonymizedQuery = generator.stringify(anonymizedQueryObj);
        const anonymizedQuadsStream = await engine.queryQuads(anonymizedQuery, { unionDefaultGraph: true });
        const anonymizedQuads = deduplicateQuads(await streamToArray(anonymizedQuadsStream));
        result.set(credGraphIri, [revealedQuads, anonymizedQuads]);
    }
    return result;
};
export class Anonymizer {
    constructor(df) {
        this._genKey = (varName, val) => `${varName}:${val.termType}:${val.value}`;
        this.anonymize = (varName, val) => {
            const key = this._genKey(varName, val);
            let anon;
            if (val.termType === 'NamedNode') {
                const result = this.varToAnon.get(key);
                if (result != undefined) {
                    return result;
                }
                anon = this.df.namedNode(`${ANONI_PREFIX}${nanoid(NANOID_LEN)}`);
                this.varToAnon.set(key, anon);
            }
            else {
                const result = this.varToAnonBlank.get(key);
                if (result != undefined) {
                    return result;
                }
                anon = this.df.namedNode(`${ANONB_PREFIX}${nanoid(NANOID_LEN)}`);
                this.varToAnonBlank.set(key, anon);
            }
            return anon;
        };
        this.anonymizeObject = (varName, val) => {
            const key = this._genKey(varName, val);
            let anon;
            if (val.termType === 'NamedNode' || val.termType === 'BlankNode') {
                return this.anonymize(varName, val);
            }
            else {
                const result = this.varToAnonLiteral.get(key);
                if (result != undefined) {
                    return result;
                }
                if (val.language !== '') {
                    anon = this.df.literal(`${ANONL_PREFIX}${nanoid(NANOID_LEN)}`, val.language);
                    this.varToAnonLiteral.set(key, anon);
                }
                else {
                    anon = this.df.literal(`${ANONL_PREFIX}${nanoid(NANOID_LEN)}`, val.datatype);
                    this.varToAnonLiteral.set(key, anon);
                }
            }
            return anon;
        };
        this.varToAnon = new Map();
        this.varToAnonBlank = new Map();
        this.varToAnonLiteral = new Map();
        this.df = df;
    }
}
const anonymizeBgpTriples = (bgpTriples, vars, bindings, df, anonymizer) => bgpTriples.map((triple) => {
    const varNames = vars.map((v) => 'expression' in v ? v.variable.value : v.value);
    const _anonymize = (term) => {
        if (term.termType === 'Variable' && !varNames.includes(term.value)) {
            const val = bindings.get(term);
            if (val != undefined && isAnonymizableNonLiteralTerm(val)) {
                return anonymizer.anonymize(term.value, val);
            }
            else {
                return df.fromTerm(term); // TBD
            }
        }
        else {
            return df.fromTerm(term);
        }
    };
    const subject = _anonymize(triple.subject);
    const predicate = _anonymize(triple.predicate);
    const _anonymizeObject = (term) => {
        if (term.termType === 'Variable' && !varNames.includes(term.value)) {
            const val = bindings.get(term);
            if (val != undefined && isAnonymizableTerm(val)) {
                return anonymizer.anonymizeObject(term.value, val);
            }
            else {
                return df.fromTerm(term); // TBD
            }
        }
        else {
            return df.fromTerm(term);
        }
    };
    const object = _anonymizeObject(triple.object);
    return {
        subject, predicate, object
    };
});
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
