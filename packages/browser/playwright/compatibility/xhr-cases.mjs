import assert from 'node:assert/strict'

export const xhrScenarios = ['xhr', 'xhr-timeout-recovery', 'xhr-timeout-exhausted']
export const xhrTimeoutMs = 1000

export function assertXHRTransport(requests) {
    const flags = requests.filter(({ path }) => /^\/(flags|decide)\/?$/.test(path))
    const capture = requests.filter(({ path }) => /^\/(e|batch|i\/v1\/analytics\/events)\/?$/.test(path))
    assert(flags.length > 0, 'Forced XHR did not send a flags request')
    assert(capture.length > 0, 'Forced XHR did not deliver an event')
    for (const request of [...flags, ...capture])
        assert.equal(request.resourceType, 'xhr', `SDK ${request.path} did not use native XHR`)
    return { flags: 'xhr', capture: 'xhr' }
}

export async function exerciseXHRTimeout({ scenario, comparison, page, server, remote, received, expect }) {
    const recovering = scenario === 'xhr-timeout-recovery'
    const { afterId } = await remote('/__compat/xhr-timeout', { mode: recovering ? 'recover' : 'exhaust' })
    const callbacks = () =>
        page.evaluate(() => window.__compat.callbacks.filter(({ callback }) => callback === 'xhr-timeout'))
    await page.evaluate((timeout) => {
        const lab = window.__compat
        lab.call('set_config', [{ feature_flag_request_timeout_ms: timeout, feature_flag_request_max_retries: 1 }])
        lab.call('onFeatureFlags', [lab.callback('xhr-timeout')])
    }, xhrTimeoutMs)
    const before = (await callbacks()).length
    await page.evaluate(() => {
        window.__compat.phase = 'xhr-timeout'
        window.__compat.call('reloadFeatureFlags')
    })
    await expect.poll(async () => (await callbacks()).length).toBe(before + 1)
    const attempts = () =>
        server.inspect().requests.filter(({ id, path }) => id > afterId && /^\/(flags|decide)\/?$/.test(path))
    // These published historical cores predate automatic flag timeout retries.
    const automaticAttempts = comparison === 'current' ? 2 : 1
    assert.equal(attempts().length, automaticAttempts, 'Incorrect automatic XHR timeout attempt count')
    const firstCallback = (await callbacks()).at(-1)
    assert.equal(firstCallback.values[2].errorsLoading, !(recovering && comparison === 'current'))
    const automaticCallbacks = (await callbacks()).length - before

    if (recovering && comparison === 'historical') {
        await page.evaluate(() => {
            window.__compat.phase = 'xhr-manual-recovery'
            window.__compat.call('reloadFeatureFlags')
        })
        await expect.poll(async () => (await callbacks()).length).toBe(before + 2)
        assert.equal((await callbacks()).at(-1).values[2].errorsLoading, false)
    }
    await expect
        .poll(() => server.inspect().blockedRequests.filter(({ barrier }) => barrier === 'xhr-timeout').length)
        .toBe(0)
    const requests = attempts()
    const expectedAttempts = recovering ? 2 : automaticAttempts
    assert.equal(requests.length, expectedAttempts, 'Unexpected extra XHR timeout request')
    const timedOut = requests.filter(({ status }) => status === null)
    assert.equal(timedOut.length, recovering ? 1 : automaticAttempts)
    assert(
        timedOut.every(({ responseFinished }) => !responseFinished),
        'Timed-out XHR received a response'
    )
    if (recovering) assert.equal(requests.at(-1).status, 200)
    assert.deepEqual(
        requests.map(({ body }) => body),
        requests.map(() => requests[0].body),
        'XHR retry changed the flag evaluation context'
    )
    const cached = await page.evaluate(() => {
        const lab = window.__compat
        lab.phase = 'xhr-result'
        return lab.call('getFeatureFlag', ['compat-timeout'])
    })
    assert.equal(cached, recovering ? 'fresh' : 'cached', 'XHR timeout discarded or failed to refresh cached flags')
    await expect
        .poll(
            async () =>
                (await received()).events.filter(
                    ({ event, properties }) =>
                        event === '$feature_flag_called' && properties.$feature_flag === 'compat-timeout'
                ).length
        )
        .toBe(1)
    const event = (await received()).events.find(
        ({ event, properties }) => event === '$feature_flag_called' && properties.$feature_flag === 'compat-timeout'
    )
    const error = event.properties.$feature_flag_error
    assert.equal(error, recovering ? undefined : comparison === 'current' ? 'timeout' : 'api_error_0')
    assert.equal((await callbacks()).length - before, recovering && comparison === 'historical' ? 2 : 1)
    return {
        automaticAttempts,
        automaticCallbacks,
        totalAttempts: requests.length,
        timedOut: timedOut.length,
        cached,
        ...(error === undefined ? {} : { error }),
    }
}
