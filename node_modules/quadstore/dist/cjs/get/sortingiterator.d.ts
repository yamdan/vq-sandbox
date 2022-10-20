import { AsyncIterator } from 'asynciterator';
export declare class SortingIterator<In, Int, Out> extends AsyncIterator<Out> {
    constructor(source: AsyncIterator<In>, compare: (left: Int, right: Int) => number, digest: (item: In) => Int, emit: (item: Int) => Out);
}
