import { _info } from '../../utils/event-utils'
import * as globals from '../../utils/globals'

jest.mock('../../utils/globals')

describe(`event-utils`, () => {
    it('should have $host and $pathname in properties', () => {
        const properties = _info.properties()
        expect(properties['$current_url']).toBeDefined()
        expect(properties['$host']).toBeDefined()
        expect(properties['$pathname']).toBeDefined()
    })

    it('should have user agent in properties', () => {
        // TS doesn't like it but we can assign userAgent
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        globals['userAgent'] = 'blah'
        const properties = _info.properties()
        expect(properties['$raw_user_agent']).toBe('blah')
    })

    it('should truncate very long user agents in properties', () => {
        // TS doesn't like it but we can assign userAgent
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        globals['userAgent'] = 'a'.repeat(1001)
        const properties = _info.properties()
        expect(properties['$raw_user_agent'].length).toBe(1000)
        expect(properties['$raw_user_agent'].substring(995)).toBe('aa...')
    })
})
