import { captureLogger, initPosthog, staticFilesMock } from './helpers'
import { t, ClientFunction } from 'testcafe'

// eslint-disable-next-line no-undef
fixture`Subdomain detection`
    .page('http://localhost:8000/playground/cypress-full/index.html')
    .requestHooks(captureLogger, staticFilesMock)
    .afterEach(async () => {
        const browserLogs = await t.getBrowserConsoleMessages()
        Object.keys(browserLogs).forEach((level) => {
            browserLogs[level].forEach((line) => {
                // eslint-disable-next-line no-console
                console.log(`Browser ${level}:`, line)
            })
        })

        // console.debug('Requests to posthog:', JSON.stringify(captureLogger.requests, null, 2))
    })

const testCases = [
    {
        location: 'www.google.co.uk',
        expected: '.google.co.uk',
    },
    {
        location: 'www.google.com',
        expected: '.google.com',
    },
    {
        location: 'www.google.com.au',
        expected: '.google.com.au',
    },
    {
        location: 'localhost',
        expected: '',
    },
]

const getSubject = ClientFunction(() => {
    return window.POSTHOG_INTERNAL_seekFirstNonPublicSubDomain
})

testCases.forEach(({ location, expected }) => {
    test(`location ${location} is detected as having subdomain ${expected}`, async (t) => {
        await initPosthog()
        await t.expect(getSubject()(location)).eql(expected)
    })
})
