import type { Quad, Term } from 'rdf-js';
import type { TermName } from '../types';
export declare const getTermComparator: () => (a: Term, b: Term) => (-1 | 0 | 1);
export declare const getQuadComparator: (_termNames?: TermName[]) => (a: Quad, b: Quad) => (-1 | 0 | 1);
