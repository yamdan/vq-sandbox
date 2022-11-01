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
// utility function to identify graphs
export const identifyGraphs = async (query, df, engine) => {
    var _a, _b;
    // parse the original SELECT query to get Basic Graph Pattern (BGP)
    const parser = new sparqljs.Parser();
    const parsedQuery = parser.parse(query);
    if (!(parsedQuery.type === 'query' && parsedQuery.queryType === 'SELECT')) {
        return undefined;
    }
    const bgpPattern = (_a = parsedQuery.where) === null || _a === void 0 ? void 0 : _a.filter((p) => p.type === 'bgp')[0];
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
    const graphVarToTriple = Object.assign({}, ...bgpPattern.triples.map((triple, i) => ({
        [`${GRAPH_VAR_PREFIX}${i}`]: triple
    })));
    // generate a new query to identify named graphs
    parsedQuery.variables = [...Array(graphPatterns.length)].map((_, i) => df.variable(`${GRAPH_VAR_PREFIX}${i}`));
    parsedQuery.where = (_b = parsedQuery.where) === null || _b === void 0 ? void 0 : _b.concat(graphPatterns);
    const generator = new sparqljs.Generator();
    const generatedQuery = generator.stringify(parsedQuery);
    // extract identified graphs from the query result
    const bindingsStream = await engine.queryBindings(generatedQuery, { unionDefaultGraph: true });
    const bindingsArray = await streamToArray(bindingsStream);
    const result = [];
    for (const bindings of bindingsArray) {
        const graphAndGraphVars = [...bindings].map((b) => ([b[1].value, b[0].value]));
        const graphAndPatterns = graphAndGraphVars.map(([graph, gvar]) => [graph, graphVarToTriple[gvar]]);
        const graphToTriples = entriesToMap(graphAndPatterns);
        result.push(graphToTriples);
    }
    ;
    return result;
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
