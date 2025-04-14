import {
    getBrowserLanguage,
    getBrowserLanguagePrefix,
    getEventProperties,
    getTimezone,
    getTimezoneOffset,
} from '../../utils/event-utils'
import * as globals from '../../utils/globals'

describe(`event-utils`, () => {
    describe('properties', () => {
        it('should have $host and $pathname in properties', () => {
            const properties = getEventProperties()
            expect(properties['$current_url']).toBeDefined()
            expect(properties['$host']).toBeDefined()
            expect(properties['$pathname']).toBeDefined()
        })

        it('should have user agent in properties', () => {
            // TS doesn't like it but we can assign userAgent
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            globals['userAgent'] = 'blah'
            const properties = getEventProperties()
            expect(properties['$raw_user_agent']).toBe('blah')
        })

        it('should truncate very long user agents in properties', () => {
            // TS doesn't like it but we can assign userAgent
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            globals['userAgent'] = 'a'.repeat(1001)
            const properties = getEventProperties()
            expect(properties['$raw_user_agent'].length).toBe(1000)
            expect(properties['$raw_user_agent'].substring(995)).toBe('aa...')
        })

        it('should mask out personal data from URL', () => {
            // @ts-expect-error ok to set global in test
            globals.location = { href: 'https://www.example.com/path?gclid=12345&other=true' }
            const properties = getEventProperties(true)
            expect(properties['$current_url']).toEqual('https://www.example.com/path?gclid=<masked>&other=true')
        })

        it('should mask out custom personal data', () => {
            // @ts-expect-error ok to set global in test
            globals.location = { href: 'https://www.example.com/path?gclid=12345&other=true' }
            const properties = getEventProperties(true, ['other'])
            expect(properties['$current_url']).toEqual('https://www.example.com/path?gclid=<masked>&other=<masked>')
        })
    })

    describe('timezones', () => {
        it('should compute timezone', () => {
            const timezone = getTimezone()
            expect(typeof timezone).toBe('string')
        })

        it('should compute timezone offset as a number', () => {
            const offset = getTimezoneOffset()
            expect(typeof offset).toBe('number')
        })
    })

    describe('browser language', () => {
        let languageGetter: jest.SpyInstance

        beforeEach(() => {
            languageGetter = jest.spyOn(window.navigator, 'language', 'get')
            languageGetter.mockReturnValue('pt-BR')
        })

        it('should compute browser language', () => {
            const language = getBrowserLanguage()
            expect(language).toBe('pt-BR')
        })

        it('should compute browser language prefix', () => {
            const languagePrefix = getBrowserLanguagePrefix()
            expect(languagePrefix).toBe('pt')
        })
    })
})
