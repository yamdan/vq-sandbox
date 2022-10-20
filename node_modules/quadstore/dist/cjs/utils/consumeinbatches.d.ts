import { TSReadable } from '../types';
export declare const consumeInBatches: <T>(readable: TSReadable<T>, batchSize: number, onEachBatch: (items: T[]) => any) => Promise<void>;
