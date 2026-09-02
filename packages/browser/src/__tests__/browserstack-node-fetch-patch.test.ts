/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */

const {
    isRetryableError,
    isRetryableStatus,
    isSetupRequest,
    patchNodeFetch,
} = require('../../testcafe/browserstack-node-fetch-patch.cjs')

const setupUrl = 'https://hub-cloud.browserstack.com/wd/hub/session'
const browserListUrl = 'https://api.browserstack.com/automate/browsers.json'

function response(status, payload) {
    return {
        status,
        body: { destroy: jest.fn() },
        json: jest.fn(async () => payload),
    }
}

describe('browserstack-node-fetch-patch', () => {
    let warnSpy

    beforeEach(() => {
        process.env.BROWSERSTACK_API_MAX_ATTEMPTS = '3'
        process.env.BROWSERSTACK_API_BACKOFF_MS = '0'
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        delete process.env.BROWSERSTACK_API_MAX_ATTEMPTS
        delete process.env.BROWSERSTACK_API_BACKOFF_MS
        warnSpy.mockRestore()
    })

    it.each([408, 409, 425, 429, 500, 503])('retries retryable HTTP status %s', async (status) => {
        const firstResponse = response(status, { status: 13 })
        const secondResponse = response(200, { ok: true })
        const fetch = jest.fn(async () => (fetch.mock.calls.length === 1 ? firstResponse : secondResponse))

        const patchedFetch = patchNodeFetch(fetch)
        const patchedResponse = await patchedFetch(browserListUrl)
        await expect(patchedResponse.json()).resolves.toEqual({ ok: true })

        expect(fetch).toHaveBeenCalledTimes(2)
        expect(firstResponse.body.destroy).toHaveBeenCalledTimes(1)
    })

    it('retries retryable transport errors', async () => {
        const error = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
        const fetch = jest
            .fn()
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce(response(200, { ok: true }))

        const patchedResponse = await patchNodeFetch(fetch)(browserListUrl)

        await expect(patchedResponse.json()).resolves.toEqual({ ok: true })
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('retries retryable response body read errors', async () => {
        const bodyError = Object.assign(new Error('Invalid response body: Premature close'), {
            code: 'ERR_STREAM_PREMATURE_CLOSE',
        })
        const firstResponse = response(200, { unused: true })
        firstResponse.json.mockRejectedValueOnce(bodyError)
        const fetch = jest
            .fn()
            .mockResolvedValueOnce(firstResponse)
            .mockResolvedValueOnce(response(200, { recovered: true }))

        const patchedResponse = await patchNodeFetch(fetch)(setupUrl, { method: 'POST' })

        await expect(patchedResponse.json()).resolves.toEqual({ recovered: true })
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('retries BrowserStack setup payload errors for transient server statuses', async () => {
        const fetch = jest
            .fn()
            .mockResolvedValueOnce(response(200, { status: 13, value: { message: 'session not created' } }))
            .mockResolvedValueOnce(response(200, { status: 0, sessionId: 'session-id' }))

        const patchedResponse = await patchNodeFetch(fetch)(setupUrl, { method: 'POST' })

        await expect(patchedResponse.json()).resolves.toEqual({ status: 0, sessionId: 'session-id' })
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('does not retry deterministic BrowserStack setup payload errors', async () => {
        const payload = { status: 7, value: { message: 'no such element' } }
        const fetch = jest.fn().mockResolvedValueOnce(response(200, payload))

        const patchedResponse = await patchNodeFetch(fetch)(setupUrl, { method: 'POST' })

        await expect(patchedResponse.json()).resolves.toEqual(payload)
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('falls back to default backoff when the backoff override is invalid', async () => {
        process.env.BROWSERSTACK_API_BACKOFF_MS = 'abc,def'
        const fetch = jest
            .fn()
            .mockResolvedValueOnce(response(500, { status: 13 }))
            .mockResolvedValueOnce(response(200, { ok: true }))

        await patchNodeFetch(fetch)(browserListUrl)

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Retrying in 1000ms.'))
    })

    it('classifies setup requests separately from later BrowserStack API requests', async () => {
        expect(isSetupRequest(browserListUrl)).toBe(true)
        expect(isSetupRequest(setupUrl, { method: 'POST' })).toBe(true)
        expect(isSetupRequest('https://hub-cloud.browserstack.com/wd/hub/session/session-id/url')).toBe(false)
        expect(
            isSetupRequest('https://hub-cloud.browserstack.com/wd/hub/session/session-id/url', { method: 'POST' })
        ).toBe(false)
    })

    it('reports actual attempts for non-retryable setup failures', async () => {
        const fetch = jest.fn().mockRejectedValueOnce(new Error('certificate failed'))

        await expect(patchNodeFetch(fetch)(setupUrl, { method: 'POST' })).rejects.toThrow(
            'POSTHOG_BROWSERSTACK_SETUP_FAILURE: BrowserStack request failed after 1 attempts'
        )
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('reports actual attempts for non-retryable body read failures', async () => {
        const firstResponse = response(200, { unused: true })
        firstResponse.json.mockRejectedValueOnce(new Error('not json'))
        const fetch = jest.fn().mockResolvedValueOnce(firstResponse)

        const patchedResponse = await patchNodeFetch(fetch)(setupUrl, { method: 'POST' })

        await expect(patchedResponse.json()).rejects.toThrow(
            'POSTHOG_BROWSERSTACK_SETUP_FAILURE: BrowserStack request failed after 1 attempts'
        )
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('keeps non-setup BrowserStack API failures distinct', async () => {
        const fetch = jest.fn().mockRejectedValueOnce(new Error('certificate failed'))

        await expect(
            patchNodeFetch(fetch)('https://hub-cloud.browserstack.com/wd/hub/session/session-id/url')
        ).rejects.toThrow('POSTHOG_BROWSERSTACK_API_FAILURE: BrowserStack request failed after 1 attempts')
    })

    it('recognizes retryable statuses and errors', () => {
        expect(isRetryableStatus(429)).toBe(true)
        expect(isRetryableStatus(500)).toBe(true)
        expect(isRetryableStatus(401)).toBe(false)
        expect(isRetryableError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(true)
        expect(isRetryableError(new Error('response aborted'))).toBe(true)
        expect(isRetryableError(Object.assign(new Error('operation aborted'), { name: 'AbortError' }))).toBe(false)
        expect(isRetryableError(new Error('certificate failed'))).toBe(false)
    })
})
