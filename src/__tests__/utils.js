/*
 * Test that basic SDK usage (init, capture, etc) does not
 * blow up in non-browser (node.js) envs. These are not
 * tests of server-side capturing functionality (which is
 * currently not supported in the browser lib).
 */

import { _ } from '../utils'

describe(`utils.js`, () => {
    it('should have $host and $pathname in properties', () => {
        const properties = _.info.properties()
        expect(properties['$current_url']).toBeDefined()
        expect(properties['$host']).toBeDefined()
        expect(properties['$pathname']).toBeDefined()
    })
})

describe('JSONEncode/JSONDecode', () => {
    let tests = [{ some: { nested: 1, [1]: 5 } }, {}, '', 5, { [5]: 999.31145 }, null]

    tests.forEach((object) => {
        it(`stringifies ${JSON.stringify(object)} correctly`, () => {
            expect(_.JSONDecode(_.JSONEncode(object))).toEqual(object)
            expect(_.JSONEncode(object).replace(/: /g, ':')).toEqual(JSON.stringify(object))
        })
    })

    it('fails to decode invalid values', () => {
        expect(() => _.JSONDecode('{invalid')).toThrow()
    })
})
