import { createServer, type IncomingMessage } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { expect, test, type WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

for (const scenario of ['same session', 'logout', 'logout with pageleave']) {
    const reset = scenario !== 'same session'
    const capturePageleave = scenario === 'logout with pageleave'
    test(
        reset
            ? 'keeps the pre-logout page under its original identity on reload: ' + scenario
            : 'recovers the failed full snapshot after a same-tab reload',
        async ({ page, context }) => {
            await page.goto('/')
            test.skip(!(await page.evaluate(() => 'onpageswap' in window)), 'Browser does not signal same-tab reloads')
            const sdkURL = new URL('/dist/array.full.js', page.url()).href
            await page.addInitScript(() => {
                // Mobile browsers can reload without notifying beforeunload listeners.
                window.onbeforeunload = (event) => {
                    event.stopImmediatePropagation()
                }
            })

            let documentNumber = 0
            let originalUuid: string | undefined
            const recovered: string[] = []
            const firstPageIdentities: string[] = []
            let secondPageIdentity: string | undefined
            let unavailable = true
            const decodeErrors: string[] = []
            async function receive(request: IncomingMessage) {
                request.setEncoding('utf8')
                let raw = ''
                for await (const part of request) raw += part
                const url = new URL(request.url!, 'http://localhost')
                if (url.searchParams.get('compression') === 'base64') {
                    const encoded = raw.startsWith('data=') ? new URLSearchParams(raw).get('data') : raw
                    raw = Buffer.from(encoded ?? '', 'base64').toString('utf8')
                }
                const events = JSON.parse(raw) as {
                    uuid: string
                    properties: { distinct_id: string; $snapshot_data: { type: number; data: unknown }[] }
                }[]
                for (const event of events) {
                    for (const snapshot of event.properties.$snapshot_data) {
                        if (snapshot.type !== 2) continue
                        const dom = JSON.stringify(snapshot.data)
                        if (dom.includes('document-1')) {
                            firstPageIdentities.push(event.properties.distinct_id)
                            if (unavailable) originalUuid ??= event.uuid
                            else recovered.push(event.uuid)
                        }
                        if (!unavailable && dom.includes('document-2'))
                            secondPageIdentity = event.properties.distinct_id
                    }
                }
            }
            // WebKit can omit beacon bodies from intercepted requests. Read the bytes delivered on the wire.
            const server = createServer((request, response) => {
                if (request.url === '/replay-fixture') {
                    response.setHeader('content-type', 'text/html')
                    response.end(`<button>document-${++documentNumber}</button><script src="${sdkURL}"></script>`)
                } else if (request.url?.startsWith('/replay-upload/')) {
                    void receive(request)
                        .then(() => response.writeHead(unavailable ? 503 : 200).end('{}'))
                        .catch((error) => {
                            decodeErrors.push(String(error))
                            response.writeHead(400).end()
                        })
                } else {
                    response.end('{}')
                }
            })
            server.listen(0, '127.0.0.1')
            await once(server, 'listening')
            try {
                const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port

                const options = {
                    url: origin + '/replay-fixture',
                    waitForFlags: false,
                    options: {
                        api_host: origin,
                        before_send: undefined,
                        capture_pageleave: capturePageleave,
                        disable_compression: true,
                        session_recording: { compress_events: false },
                    },
                    flagsResponseOverrides: { sessionRecording: { endpoint: '/replay-upload/' } },
                }

                await start(options, page, context)
                await waitForSessionRecordingToStart(page)
                const rejected = page.waitForResponse(
                    (response) =>
                        response.url().includes('/replay-upload/') && response.status() === 503 && !!originalUuid
                )
                await page.getByRole('button').click()
                await (await rejected).finished()
                const identities = await page.evaluate((reset) => {
                    const ph = (window as WindowWithPostHog).posthog!
                    const before = ph.get_distinct_id()
                    if (reset) {
                        ph.onSessionId(() => {
                            sessionStorage.setItem('fixture-session-change', 'yes')
                        })
                        ph.reset()
                        sessionStorage.removeItem('fixture-session-change')
                    }
                    return { before, after: ph.get_distinct_id() }
                }, reset)
                await start({ ...options, type: 'reload' }, page, context)
                unavailable = false
                await waitForSessionRecordingToStart(page)
                await page.getByRole('button').click()
                await expect.poll(() => secondPageIdentity, { timeout: 15000 }).toBe(identities.after)
                if (reset) {
                    expect(identities.after).not.toBe(identities.before)
                    // An explicitly enabled $pageleave is a new capture after reset and can start a session.
                    if (!capturePageleave) {
                        expect(await page.evaluate(() => sessionStorage.getItem('fixture-session-change'))).toBeNull()
                    }
                } else {
                    await expect.poll(() => recovered, { timeout: 15000 }).toEqual([originalUuid])
                }
                expect(new Set(firstPageIdentities)).toEqual(new Set([identities.before]))
            } finally {
                const closed = once(server, 'close')
                server.close()
                server.closeAllConnections()
                await closed
                expect(decodeErrors).toEqual([])
            }
        }
    )
}
