import { TSReadable } from '../types';
export declare const consumeOneByOne: <T>(iterator: TSReadable<T>, onEachItem: (item: T) => any) => Promise<void>;
