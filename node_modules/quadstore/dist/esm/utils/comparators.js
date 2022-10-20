import { termNames } from './constants.js';
export const getTermComparator = () => {
    return (a, b) => {
        if (a.termType !== b.termType) {
            return a.termType < b.termType ? -1 : 1;
        }
        if (a.termType !== 'Literal' || b.termType !== 'Literal') {
            return a.value < b.value ? -1 : (a.value === b.value ? 0 : 1);
        }
        if (a.language || b.language) {
            if (!a.language) {
                return -1;
            }
            if (!b.language) {
                return 1;
            }
            return a.language < b.language ? -1 : (a.language === b.language ? 0 : 1);
        }
        if (a.datatype || b.datatype) {
            if (!a.datatype) {
                return -1;
            }
            if (!b.datatype) {
                return 1;
            }
            if (a.datatype.value !== b.datatype.value) {
                return a.datatype.value < b.datatype.value ? -1 : 1;
            }
        }
        return a.value < b.value ? -1 : (a.value === b.value ? 0 : 1);
    };
};
export const getQuadComparator = (_termNames = termNames) => {
    const termComparator = getTermComparator();
    return (a, b) => {
        for (let i = 0, n = _termNames.length, r; i < n; i += 1) {
            r = termComparator(a[_termNames[i]], b[_termNames[i]]);
            if (r !== 0)
                return r;
        }
        return 0;
    };
};
//# sourceMappingURL=comparators.js.map