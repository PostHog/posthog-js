import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { env, stdout } from 'node:process'

import { sendCaptureV1Batch } from '../dist/capture-v1.mjs'

const host = env.POSTHOG_TEST_HOST?.replace(/\/$/, '')
const projectToken = env.POSTHOG_TEST_PROJECT_TOKEN

if (env.POSTHOG_REAL_TESTS !== '1' || !host || !projectToken) {
    throw new Error(
        'Set POSTHOG_REAL_TESTS=1, POSTHOG_TEST_HOST, and POSTHOG_TEST_PROJECT_TOKEN to run the live Capture V1 check'
    )
}

const send = async (apiHost, route) => {
    const runId = `real-ph-browser-next-v1-${route}-${Date.now()}-${randomUUID()}`
    const timestamp = new Date().toISOString()
    const result = await sendCaptureV1Batch(
        [{ api: apiHost, flags: apiHost, assets: apiHost }, projectToken, fetch, undefined],
        [
            {
                event: 'real_posthog_test_browser_next_capture_v1',
                uuid: randomUUID(),
                distinct_id: `real-posthog-test-${runId}`,
                timestamp,
                properties: {
                    test_run_id: runId,
                    source: 'browser-next-capture-v1-live',
                    synthetic: true,
                    $process_person_profile: false,
                },
            },
        ],
        '0.0.0-live',
        { maxAttempts: 1, requestTimeoutMs: 10_000, maxElapsedMs: 10_000 }
    )

    if (result.statusCode !== 200 || result.retry.length || result.drops.length || result.error) {
        throw new Error(
            `Live ${route} Capture V1 check failed: ${JSON.stringify({
                statusCode: result.statusCode,
                retry: result.retry,
                drops: result.drops,
                error: result.error instanceof Error ? result.error.message : result.error,
            })}`
        )
    }
    return { route, runId, statusCode: result.statusCode }
}

const proxy = createServer(async (request, response) => {
    try {
        if (request.method !== 'POST' || !request.url?.startsWith('/proxy/i/v1/analytics/events')) {
            response.writeHead(404).end()
            return
        }

        const headers = new Headers()
        for (const [name, value] of Object.entries(request.headers)) {
            if (!value || ['connection', 'content-length', 'host', 'transfer-encoding'].includes(name)) {
                continue
            }
            headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
        const chunks = []
        for await (const chunk of request) {
            chunks.push(chunk)
        }
        const upstream = await fetch(`${host}${request.url.slice('/proxy'.length)}`, {
            method: 'POST',
            headers,
            body: Buffer.concat(chunks),
        })
        const responseHeaders = {}
        for (const name of ['content-type', 'retry-after']) {
            const value = upstream.headers.get(name)
            if (value) {
                responseHeaders[name] = value
            }
        }
        response.writeHead(upstream.status, responseHeaders)
        response.end(Buffer.from(await upstream.arrayBuffer()))
    } catch (error) {
        response.writeHead(502, { 'Content-Type': 'text/plain' })
        response.end(error instanceof Error ? error.message : String(error))
    }
})

try {
    const direct = await send(host, 'direct')
    await new Promise((resolve, reject) => {
        proxy.once('error', reject)
        proxy.listen(0, '127.0.0.1', resolve)
    })
    const address = proxy.address()
    if (!address || typeof address === 'string') {
        throw new Error('Could not determine the local reverse-proxy address')
    }
    const proxied = await send(`http://127.0.0.1:${address.port}/proxy`, 'proxy')
    stdout.write(`${JSON.stringify({ direct, proxied })}\n`)
} finally {
    await new Promise((resolve) => proxy.close(resolve))
}
