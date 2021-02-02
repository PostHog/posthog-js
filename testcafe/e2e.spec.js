import { ClientFunction, RequestLogger } from 'testcafe'
import fetch from 'node-fetch'
import { retryUntilResults } from './helpers'

const captureLogger = RequestLogger(/ip=1/, {
    logRequestHeaders: true,
    logRequestBody: true,
    logResponseHeaders: true,
    logResponseBody: true,
    stringifyRequestBody: true,
})

const initPosthog = ClientFunction(() => {
    window.posthog.init('e2e_token_1239', { api_host: 'http://localhost:8000' })
})

async function queryAPI() {
    const response = await fetch('http://localhost:8000/api/event', {
        headers: { Authorization: 'Bearer e2e_demo_api_key' },
    })

    const { results } = JSON.parse(await response.text())
    return results
}

fixture('posthog.js capture')
    .page('http://localhost:8080/playground/cypress/index.html')
    .requestHooks(captureLogger)
    .beforeEach(() => initPosthog())

test('Captured events are accessible via /api/event', async (t) => {
    await t
        .click('[data-cy-custom-event-button]')
        .expect(captureLogger.count(() => true))
        .gte(1)

    const results = await retryUntilResults(queryAPI)

    console.log(results)

    await t.expect(results.length).gte(2)
    await t.expect(results.filter(({ event }) => event === 'custom-event').length).gte(1)
    await t.expect(results.filter(({ event }) => event === '$pageview').length).gte(1)
})
