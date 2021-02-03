import { ClientFunction, RequestLogger, t } from 'testcafe'
import fetch from 'node-fetch'
import { retryUntilResults } from './helpers'

const HEADERS = { Authorization: 'Bearer e2e_demo_api_key' }

const captureLogger = RequestLogger(/ip=1/, {
    logRequestHeaders: true,
    logRequestBody: true,
    logResponseHeaders: true,
    stringifyRequestBody: true,
})

const initPosthog = ClientFunction(() => {
    window.posthog.init('e2e_token_1239', { api_host: 'http://localhost:8000' })
})

async function queryAPI() {
    const response = await fetch('http://localhost:8000/api/event', {
        headers: HEADERS,
    })

    const { results } = JSON.parse(await response.text())
    return results
}

fixture('posthog.js capture')
    .page('http://localhost:8080/playground/cypress/index.html')
    .requestHooks(captureLogger)
    .beforeEach(() => initPosthog())
    .afterEach(async () => {
        await fetch('http://localhost:8000/delete_events/', { headers: HEADERS })

        console.debug('Browser logs:', await t.getBrowserConsoleMessages())
        console.debug('Requests to posthog:', captureLogger.requests)
    })

test('Captured events are accessible via /api/event', async (t) => {
    await t
        .click('[data-cy-custom-event-button]')
        .wait(5000)
        .expect(captureLogger.count(() => true))
        .gte(1)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)
    console.log(captureLogger.requests)

    const results = await retryUntilResults(queryAPI)

    console.log(results)

    await t.expect(results.length).gte(2)
    await t.expect(results.filter(({ event }) => event === 'custom-event').length).gte(1)
    await t.expect(results.filter(({ event }) => event === '$pageview').length).gte(1)
})
