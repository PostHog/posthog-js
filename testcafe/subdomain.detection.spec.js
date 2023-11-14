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
        candidate: 'www.google.co.uk',
        expected: '.google.co.uk',
    },
    {
        candidate: 'www.google.com',
        expected: '.google.com',
    },
    {
        candidate: 'www.google.com.au',
        expected: '.google.com.au',
    },
    {
        candidate: 'localhost',
        expected: '',
    },
]

const callSubdomainFn = ClientFunction((candidate) => window.POSTHOG_INTERNAL_seekFirstNonPublicSubDomain(candidate))

testCases.forEach(({ candidate, expected }) => {
    test(`location ${candidate} is detected as having subdomain ${expected}`, async (t) => {
        await initPosthog()
        await t.expect(await callSubdomainFn(candidate)).eql(expected)
    })
})
