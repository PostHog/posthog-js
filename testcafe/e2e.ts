import { ClientFunction, RequestLogger } from 'testcafe'
import fetch from 'node-fetch'

const captureLogger = RequestLogger(/ip=1/, {
    logRequestHeaders: true,
    logRequestBody: true,
    logResponseHeaders: true,
    logResponseBody: true,
    stringifyRequestBody: true,
    // stringifyResponseBody: true,
})

const initPosthog = ClientFunction(() => {
    const $win: any = window
    $win.posthog.init('e2e_token_1239', { api_host: 'http://localhost:8000' })
})

fixture('posthog.js capture').page('http://localhost:8080/playground/cypress/index.html').requestHooks(captureLogger)

test('Captured events are accessible via /api/event', async (t) => {
    await initPosthog()
    await t
        .click('[data-cy-custom-event-button]')
        .expect(captureLogger.count(() => true))
        .gt(1)

    const response = await fetch('http://localhost:8000/api/event', {
        headers: { Authorization: 'Bearer e2e_demo_api_key' },
    })

    const { results } = JSON.parse(await response.text())

    console.log(results)

    await t.expect(results.length).gt(3)
    await t.expect(results.filter(({ event }) => event === 'custom-event').length).gte(1)
    await t.expect(results.filter(({ event }) => event === '$pageview').length).gte(1)
})
