import { deduplicateKeys, optimisePerformanceData, pageLoadFrom } from '../apm'
import veryLargePerfJson from './very-large-performance-data.json'
import optimisedVeryLargePerfJson from './optimised-very-large-performance-data.json'

describe('when capturing performance data', () => {
    it('reduces the size of very large payloads of navigation objects', () => {
        const processedPerformanceJson = optimisePerformanceData(veryLargePerfJson.navigation)
        expect(processedPerformanceJson).toEqual(optimisedVeryLargePerfJson.navigation)
    })

    it('reduces the size of very large payloads of paint objects', () => {
        const processedPerformanceJson = optimisePerformanceData(veryLargePerfJson.paint)
        expect(processedPerformanceJson).toEqual(optimisedVeryLargePerfJson.paint)
    })

    it('reduces the size of very large payloads of resource objects', () => {
        const processedPerformanceJson = optimisePerformanceData(veryLargePerfJson.resource)
        //stringifying to get around toEqual's odd behaviour comparing null/undefined array contents
        expect(JSON.stringify(processedPerformanceJson)).toEqual(JSON.stringify(optimisedVeryLargePerfJson.resource))
    })

    it('can read page load duration from optimised data', () => {
        const pageLoad = pageLoadFrom({ navigation: optimisePerformanceData(veryLargePerfJson.navigation) })
        expect(pageLoad).toBe(938.3)
    })

    it('can safely read absent page load duration from optimised data', () => {
        const navigation = optimisePerformanceData(veryLargePerfJson.navigation)
        navigation[0].splice(2) //remove duration
        const pageLoad = pageLoadFrom({ navigation: navigation })
        expect(pageLoad).toBe(undefined)
    })

    describe('each top-level array in the performance data (navigation, paint, and resources) is an array containing items of the same objects', () => {
        it('can deduplicate keys for an empty array', () => {
            const actual = deduplicateKeys([])
            expect(actual).toEqual([])
        })

        it('can deduplicate keys for one object', () => {
            const actual = deduplicateKeys([{ a: 'b', c: 'd' }])
            expect(actual).toEqual([['a', 'c'], [['b', 'd']]])
        })

        it('can deduplicate keys for two objects with the same keys', () => {
            const actual = deduplicateKeys([
                { a: 'b', c: 'd' },
                { a: 'e', c: 'f' },
            ])
            expect(actual).toEqual([
                ['a', 'c'],
                [
                    ['b', 'd'],
                    ['e', 'f'],
                ],
            ])
        })

        it('can deduplicate keys for two identical objects', () => {
            const actual = deduplicateKeys([
                { a: 'b', c: 'd' },
                { a: 'b', c: 'd' },
            ])
            expect(actual).toEqual([
                ['a', 'c'],
                [
                    ['b', 'd'],
                    ['b', 'd'],
                ],
            ])
        })
    })
})
