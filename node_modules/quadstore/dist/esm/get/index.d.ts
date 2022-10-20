import type { Quadstore } from '../quadstore';
import type { ApproximateSizeResult, GetOpts, Pattern, QuadStreamResultWithInternals } from '../types';
export declare const getStream: (store: Quadstore, pattern: Pattern, opts: GetOpts) => Promise<QuadStreamResultWithInternals>;
export declare const getApproximateSize: (store: Quadstore, pattern: Pattern, opts: GetOpts) => Promise<ApproximateSizeResult>;
