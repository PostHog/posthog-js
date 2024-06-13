import { assert, object, property, VerbosityLevel } from 'fast-check'
import { estimateSize } from '../../../../extensions/replay/utils/estimate-size'
import { isEmptyObject } from '../../../../utils/type-utils'

/**
 * We can use property based testing to generate many different objects
 * to test that estimateSize at least returns a number without throwing
 * an error.
 *
 * The object generator will attempt to create pathological objects.
 * So, we'll test many edge cases in one test.
 *
 * NB, This doesn't prove that the generated size estimate is correct!
 */
describe('using property based testing to identify edge cases in size estimation', () => {
    it('can use many combinations of objects and unexpected input to detect if the method throws', () => {
        assert(
            property(object(), (arbitraryObject) => {
                const size = estimateSize(arbitraryObject)
                // if the object is empty, the size should be 2 (empty object '{}')
                // otherwise, it should be bigger than that
                const _isEmptyObject =
                    isEmptyObject(arbitraryObject) ||
                    // this is a silly edgecase that I don't think it's worth pushing into `isEmptyObject`
                    JSON.stringify(arbitraryObject) === JSON.stringify({ '': undefined })
                return _isEmptyObject ? size == 2 : size >= 3
            }),
            { numRuns: 1000, verbose: VerbosityLevel.VeryVerbose }
        )
    })

    it('can estimate size for simple circular nested objects', () => {
        const obj: Record<string, any> = {}
        obj.something = obj
        const size = estimateSize(obj)
        expect(size).toBeGreaterThan(3)
    })

    it('can estimate size for one-level deep circular nested objects', () => {
        const obj: Record<string, any> = {}
        obj.something = { one: 2, circ: obj }
        const size = estimateSize(obj)
        expect(size).toBeGreaterThan(3)
    })

    it('can estimate size for complex circular objects', () => {
        const someObject = { emit: 1 }
        // the same object can be there multiple times
        const circularObject: Record<string, any> = {
            emit: someObject,
            again: someObject,
            aThing: {
                anArray: [1, 2, 3],
                aFurtherNestedThing: { aNumber: 4 },
            },
        }

        // but a circular reference will be replaced
        circularObject.circularReference = circularObject
        circularObject.aThing.aFurtherNestedThing.circularReference = circularObject.circularReference

        const size = estimateSize(circularObject)
        expect(size).toBeGreaterThan(3)
    })
})
