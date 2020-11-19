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

describe('_.truncate', () => {
    given('subject', () => _.truncate(given.target, given.maxStringLength))

    given('target', () => ({
        key: 'value',
        [5]: 'looongvalue',
        nested: {
            keeeey: ['vaaaaaalue', 1, 99999999999.4],
        },
    }))
    given('maxStringLength', () => 5)

    it('truncates objects', () => {
        expect(given.subject).toEqual({
            key: 'value',
            [5]: 'looon',
            nested: {
                keeeey: ['vaaaa', 1, 99999999999.4],
            },
        })
    })

    it('makes a copy', () => {
        const copy = given.subject

        given.target.foo = 'bar'

        expect(copy).not.toEqual(given.target)
    })

    it('does not truncate when passed null', () => {
        given('maxStringLength', () => null)

        expect(given.subject).toEqual(given.subject)
    })

    it('handles recursive objects', () => {
        given('target', () => {
            const object = { key: 'vaaaaalue' }
            object.ref = object
            return object
        })

        const expected = { key: 'vaaaa' }
        expected.ref = expected

        expect(given.subject).toEqual(expected)
    })
})
