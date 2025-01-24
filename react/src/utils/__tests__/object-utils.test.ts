import { isDeepEqual } from '../object-utils'

const circularArray1: any[] = []
circularArray1.push(circularArray1)
const circularArray2: any[] = []
circularArray2.push(circularArray2)

function f1() {}
function f2() {}

describe('object-utils', () => {
    describe('isDeepEqual', () => {
        it.each([
            [true, { a: 1, b: 2 }, { a: 1, b: 2 }],
            [true, { a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }],
            [false, { a: 1, b: 2 }, { a: 1, b: 3 }],
            [false, { a: 1, b: 2 }, { a: 1 }],
            [true, 'a', 'a'],
            [false, 'a', 'b'],
            [false, 1, 2],
            [true, 0, -0],
            [false, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
            [false, 1, '1'],
            [false, Number.NaN, Number.NaN],
            [true, null, null],
            [false, undefined, null],
            [true, [], []],
            [true, [[[[]]]], [[[[]]]]],
            [false, [[[[]]]], [[[[[]]]]]],
            [true, [1, 2, 3], [1, 2, 3]],
            [false, [1, 2, 3], [1, 2, 4]],
            [true, { a: circularArray1 }, { a: circularArray1 }],
            // [false, { a: circularArray1 }, { a: circularArray2 }], // TODO
            [true, f1, f1],
            [false, f1, f2],
        ])('returns %s for %s and %s', (expected, obj1, obj2) => {
            expect(isDeepEqual(obj1, obj2)).toBe(expected)
            expect(isDeepEqual(obj2, obj1)).toBe(expected)
        })
    })
})
