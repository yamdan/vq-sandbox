import sparqljs from 'sparqljs';
// Constants
const GRAPH_VAR_PREFIX = 'ggggg'; // TBD
export const extractVars = (query) => {
    const parser = new sparqljs.Parser();
    const parsedQuery = parser.parse(query);
    if (!(parsedQuery.type === 'query' && parsedQuery.queryType === 'SELECT')) {
        return undefined;
    }
    return parsedQuery.variables;
};
// identify credentials related to the given query
export const identifyCreds = async (query, df, engine) => {
    var _a, _b;
    // parse the original SELECT query to get Basic Graph Pattern (BGP)
    const parser = new sparqljs.Parser();
    const parsedQuery = parser.parse(query);
    if (!(parsedQuery.type === 'query' && parsedQuery.queryType === 'SELECT')) {
        return undefined;
    }
    const bgpPattern = (_a = parsedQuery.where) === null || _a === void 0 ? void 0 : _a.filter((p) => p.type === 'bgp')[0];
    // create graph patterns based on BGPs 
    const graphPatterns = bgpPattern.triples.map((triple, i) => {
        const patterns = [
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
    const graphVarToBgpTriple = Object.assign({}, ...bgpPattern.triples.map((triple, i) => ({
        [`${GRAPH_VAR_PREFIX}${i}`]: triple
    })));
    // generate a new SELECT query to identify named graphs
    parsedQuery.distinct = true;
    if (!isWildcard(parsedQuery.variables)) {
        parsedQuery.variables = parsedQuery.variables.concat([...Array(graphPatterns.length)].map((_, i) => df.variable(`${GRAPH_VAR_PREFIX}${i}`)));
    }
    parsedQuery.where = (_b = parsedQuery.where) === null || _b === void 0 ? void 0 : _b.concat(graphPatterns);
    const generator = new sparqljs.Generator();
    const generatedQuery = generator.stringify(parsedQuery);
    // extract identified graphs from the query result
    const bindingsStream = await engine.queryBindings(generatedQuery, { unionDefaultGraph: true });
    const bindingsArray = await streamToArray(bindingsStream);
    const result = [];
    for (const bindings of bindingsArray) {
        const graphIriAndGraphVars = [...bindings].filter((b) => b[0].value.startsWith(GRAPH_VAR_PREFIX)).map((b) => ([b[1].value, b[0].value]));
        const graphIriAndBgpTriples = graphIriAndGraphVars.map(([graph, gvar]) => [graph, graphVarToBgpTriple[gvar]]);
        const graphIriToBgpTriples = entriesToMap(graphIriAndBgpTriples);
        result.push(graphIriToBgpTriples);
    }
    ;
    return { result, bindingsArray };
};
export const getRevealedQuads = async (credGraphIri, bgpTriples, query, df, engine) => {
    const parser = new sparqljs.Parser();
    const parsedSelectQuery = parser.parse(query);
    if (!(parsedSelectQuery.type === 'query' && parsedSelectQuery.queryType === 'SELECT')) {
        return undefined;
    }
    const parsedQuery = {
        queryType: 'CONSTRUCT',
        type: 'query',
        prefixes: {},
    };
    const bgpPattern = {
        type: 'bgp',
        triples: bgpTriples
    };
    const where = [{
            type: 'graph',
            patterns: [bgpPattern],
            name: df.namedNode(credGraphIri)
        }];
    parsedQuery.where = where;
    parsedQuery.template = bgpTriples;
    const generator = new sparqljs.Generator();
    const generatedQuery = generator.stringify(parsedQuery);
    const quadsStream = await engine.queryQuads(generatedQuery, { unionDefaultGraph: true });
    const quadsArray = await streamToArray(quadsStream);
    return quadsArray;
};
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
