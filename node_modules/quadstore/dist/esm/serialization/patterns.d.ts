import type { InternalIndex, Pattern, Prefixes, IndexQuery } from '../types';
export declare const writePattern: (pattern: Pattern, index: InternalIndex, prefixes: Prefixes) => IndexQuery | null;
