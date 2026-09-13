// Opt-in correctness reproduction and alternating shipping-artifact benchmark.
// See benchmark-replay-fetch.md. This is a Node/Playwright harness, not SDK code.
// oxlint-disable compat/compat
// Browser-evaluated fixture callbacks cannot close over imported SDK type helpers.
// oxlint-disable posthog-js/no-direct-null-check, posthog-js/no-direct-undefined-check
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, webkit } from '@playwright/test'

const mode = process.env.REPLAY_FETCH_MODE || 'correctness'
assert(['correctness', 'benchmark'].includes(mode))
const output = process.env.REPLAY_FETCH_OUTPUT
assert(output, 'Set REPLAY_FETCH_OUTPUT to a scratch directory outside the repository')
const baseline = process.env.REPLAY_FETCH_BASELINE
const candidate = process.env.REPLAY_FETCH_CANDIDATE
assert(baseline && candidate, 'Set both artifact directories (containing recorder.js)')
const abortOnly = process.env.REPLAY_FETCH_CASE === 'abort'
const runs = mode === 'benchmark' || abortOnly ? Number(process.env.REPLAY_FETCH_RUNS || (abortOnly ? 3 : 30)) : 1
assert(Number.isSafeInteger(runs) && runs > 0, 'REPLAY_FETCH_RUNS must be a positive safe integer')
const engines = (process.env.REPLAY_FETCH_BROWSERS || 'chromium,webkit').split(',')
const wrappers = (process.env.REPLAY_FETCH_WRAPPERS || 'none,inner,outer').split(',')
assert(wrappers.length > 0 && wrappers.every((wrapper) => ['none', 'inner', 'outer'].includes(wrapper)))
const cancellationOnly = process.env.REPLAY_FETCH_CASE === 'cancellation'
const arms =
    mode === 'benchmark' || cancellationOnly || abortOnly
        ? ['baseline', 'candidate', 'disabled']
        : [process.env.REPLAY_FETCH_ARM || 'candidate']
const artifacts = { baseline, candidate, disabled: candidate }
const assets = Object.fromEntries(
    await Promise.all(
        Object.entries(artifacts).map(async ([arm, dir]) => [arm, await readFile(path.join(dir, 'recorder.js'))])
    )
)
const gates = new Map()
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture')
    if (url.pathname === '/') return res.end('<!doctype html><html><body>fetch fixture</body></html>')
    if (url.pathname === '/recorder.js') {
        res.setHeader('Content-Type', 'text/javascript')
        return res.end(assets[url.searchParams.get('arm')])
    }
    if (url.pathname === '/body') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const requestBody = Buffer.concat(chunks).toString()
        const kind = url.searchParams.get('kind')
        const body =
            kind === 'large'
                ? 'L'.repeat(1100000)
                : kind === 'private'
                  ? 'PRIVATE_BODY'
                  : requestBody || 'small response'
        res.setHeader('Content-Type', kind === 'binary' ? 'audio/wav' : 'text/plain')
        res.setHeader('X-Fixture', 'public')
        res.setHeader('Authorization', 'PRIVATE_HEADER')
        if (kind !== 'chunked') res.setHeader('Content-Length', Buffer.byteLength(body))
        res.flushHeaders()
        if (url.searchParams.has('gate')) {
            // WebKit needs the initial chunk to expose headers for this HTTP/1 fixture.
            res.write(body.slice(0, 2))
            gates.set(url.searchParams.get('gate'), () => {
                setTimeout(() => res.end(body.slice(2)), 10)
            })
        } else if (kind === 'delayed') {
            res.write(body.slice(0, 2))
            setTimeout(() => res.end(body.slice(2)), 200)
        } else if (kind === 'chunked') {
            res.write(body.slice(0, 2))
            setTimeout(() => res.end(body.slice(2)), 10)
        } else res.end(body)
        return
    }
    res.writeHead(404).end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
await mkdir(output, { recursive: true })
await writeFile(
    path.join(output, 'manifest.json'),
    JSON.stringify(
        {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            mode,
            runs,
            engines,
            wrappers,
            case: process.env.REPLAY_FETCH_CASE || 'body',
            allowUnsafeCandidate: process.env.REPLAY_FETCH_ALLOW_UNSAFE_CANDIDATE === '1',
            artifacts: Object.fromEntries(
                Object.entries(assets).map(([arm, bytes]) => [
                    arm,
                    {
                        path: path.join(artifacts[arm], 'recorder.js'),
                        sha256: createHash('sha256').update(bytes).digest('hex'),
                    },
                ])
            ),
        },
        null,
        2
    )
)
const results = []
const failures = []
try {
    for (const engine of engines) {
        assert(['chromium', 'webkit'].includes(engine))
        const browser = await { chromium, webkit }[engine].launch()
        try {
            for (let run = 0; run < runs; run++) {
                for (const arm of run % 2 ? [...arms].reverse() : arms) {
                    for (const streaming of [false, true]) {
                        for (const wrapper of wrappers) {
                            const context = await browser.newContext()
                            const page = await context.newPage()
                            const errors = []
                            page.on('pageerror', (e) => errors.push(e.message))
                            try {
                                await page.goto(origin)
                                await page.addScriptTag({ url: `${origin}/recorder.js?arm=${arm}` })
                                await page.evaluate(
                                    ({ arm, streaming, wrapper }) => {
                                        window.entries = []
                                        window.longTasks = []
                                        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
                                            new PerformanceObserver((list) =>
                                                window.longTasks.push(...list.getEntries().map((e) => e.duration))
                                            ).observe({ entryTypes: ['longtask'] })
                                        }
                                        window.nativeFetch = window.fetch
                                        window.headersSeen = {}
                                        window.dispatches = {}
                                        window.hostSettled = {}
                                        const wrap = () => {
                                            const next = window.fetch
                                            window.fetch = (url, init) => {
                                                // Safari incident reproduction: forward an existing Request's body,
                                                // but preserve the caller's URL/init arguments otherwise.
                                                const promise =
                                                    url instanceof Request
                                                        ? next(url.url, {
                                                              method: url.method,
                                                              headers: url.headers,
                                                              body: url.body,
                                                              signal: url.signal,
                                                              duplex: 'half',
                                                          })
                                                        : next(url, init)
                                                return promise
                                            }
                                        }
                                        // A transparent native-headers witness, below both instrumentation layers.
                                        const native = window.fetch
                                        window.fetch = (...args) => {
                                            window.dispatches[String(args[0])] = true
                                            return native(...args).then((res) => {
                                                window.headersSeen[res.url] = true
                                                return res
                                            })
                                        }
                                        if (wrapper === 'inner') wrap()
                                        const plugin = window.getRecordNetworkPlugin({
                                            recordBody: arm !== 'disabled',
                                            recordHeaders: arm !== 'disabled',
                                            streamNetworkBody: streaming,
                                            initiatorTypes: ['fetch'],
                                            maskRequestFn: (entry) => {
                                                // Verify asynchronous enrichment finishes BEFORE the configured
                                                // privacy hook and cannot mutate an already emitted object later.
                                                if (entry.name.includes('kind=private')) {
                                                    if (entry.requestBody !== undefined) entry.requestBody = 'redacted'
                                                    if (entry.responseBody !== undefined)
                                                        entry.responseBody = 'redacted'
                                                }
                                                if (entry.requestHeaders) delete entry.requestHeaders.authorization
                                                if (entry.responseHeaders) delete entry.responseHeaders.authorization
                                                return entry
                                            },
                                        })
                                        window.stopRecording = window.rrweb.record({
                                            emit: (event) => {
                                                if (event.type === 6 && event.data.plugin === 'rrweb/network@1') {
                                                    window.entries.push(
                                                        ...JSON.parse(JSON.stringify(event.data.payload.requests))
                                                    )
                                                }
                                            },
                                            plugins: [plugin],
                                        })
                                        if (wrapper === 'outer') wrap()
                                    },
                                    { arm, streaming, wrapper }
                                )
                                if (abortOnly) {
                                    const gate = `abort-${engine}-${run}-${arm}-${streaming}-${wrapper}`
                                    const url = `${origin}/body?gate=${gate}`
                                    await page.evaluate((url) => {
                                        window.abortController = new AbortController()
                                        window.abortEvents = ['invoke']
                                        window.abortedBody = fetch(url, { signal: window.abortController.signal })
                                            .then((response) => {
                                                window.abortEvents.push('response')
                                                return response.text()
                                            })
                                            .then(
                                                () => ({ name: 'unexpected success' }),
                                                (error) => ({ name: error.name, message: error.message })
                                            )
                                    }, url)
                                    await page.waitForFunction((url) => window.headersSeen[url], url)
                                    await page.evaluate(() => {
                                        window.abortEvents.push('abort')
                                        window.abortController.abort()
                                    })
                                    const rejection = await page.evaluate(() => window.abortedBody)
                                    gates.get(gate)()
                                    gates.delete(gate)
                                    const events = await page.evaluate(() => window.abortEvents)
                                    if (rejection.name !== 'AbortError')
                                        failures.push(
                                            `${gate}: expected AbortError, got ${rejection.name}: ${rejection.message}`
                                        )
                                    results.push({
                                        engine,
                                        run,
                                        arm,
                                        streaming,
                                        wrapper,
                                        samples: [],
                                        rejection,
                                        events,
                                    })
                                    continue
                                }
                                if (cancellationOnly) {
                                    const gate = `cancel-${engine}-${arm}-${streaming}-${wrapper}`
                                    const url = `${origin}/body?gate=${gate}`
                                    // Benchmark arms receive the same body-release deadline relative to
                                    // invocation, not relative to their differently timed Response delivery.
                                    const releaseAt = mode === 'benchmark' ? Date.now() + 2000 : 0
                                    await page.evaluate((url) => {
                                        const start = performance.now()
                                        window.cancelState = { responseMs: null, cancelMs: null, events: ['invoke'] }
                                        fetch(url).then((response) => {
                                            window.cancelState.responseMs = performance.now() - start
                                            window.cancelState.events.push('response')
                                            response.body.cancel().then(() => {
                                                window.cancelState.cancelMs = performance.now() - start
                                                window.cancelState.events.push('cancel-settled')
                                            })
                                        })
                                    }, url)
                                    await page.waitForFunction(() => window.cancelState.responseMs !== null)
                                    const atResponse = await page.evaluate(async () => {
                                        for (let i = 0; i < 20; i++) await Promise.resolve()
                                        return structuredClone(window.cancelState)
                                    })
                                    // Correctness watchdog, not a throughput benchmark: exceed the existing
                                    // 500ms recorder bound, while the server still withholds the remainder.
                                    await page.waitForTimeout(650)
                                    const afterReadBound = await page.evaluate(() =>
                                        structuredClone(window.cancelState)
                                    )
                                    if (releaseAt)
                                        await new Promise((resolve) =>
                                            setTimeout(resolve, Math.max(0, releaseAt - Date.now()))
                                        )
                                    await page.evaluate(() => window.cancelState.events.push('release-body'))
                                    gates.get(gate)()
                                    gates.delete(gate)
                                    await page.waitForFunction(() => window.cancelState.cancelMs !== null)
                                    const final = await page.evaluate(() => window.cancelState)
                                    if (engine === 'webkit' && !streaming && arm !== 'disabled') {
                                        assert.equal(
                                            afterReadBound.cancelMs,
                                            null,
                                            'buffered WebKit clone retains the tee in BOTH shipping and candidate arms'
                                        )
                                        assert(
                                            final.events.indexOf('cancel-settled') >
                                                final.events.indexOf('release-body')
                                        )
                                    } else {
                                        assert.notEqual(
                                            afterReadBound.cancelMs,
                                            null,
                                            'cancel settles within the existing read bound without server completion'
                                        )
                                        assert(
                                            final.events.indexOf('cancel-settled') <
                                                final.events.indexOf('release-body')
                                        )
                                    }
                                    assert.deepEqual(errors, [])
                                    results.push({
                                        engine,
                                        run,
                                        arm,
                                        streaming,
                                        wrapper,
                                        samples: [],
                                        atResponse,
                                        afterReadBound,
                                        final,
                                    })
                                    continue
                                }
                                const cpu =
                                    engine === 'chromium' && mode === 'benchmark'
                                        ? await context.newCDPSession(page)
                                        : null
                                if (cpu) await cpu.send('Performance.enable')
                                const beforeCPU = cpu ? await cpu.send('Performance.getMetrics') : null
                                const samples = await page.evaluate(async () => {
                                    const samples = []
                                    const form = new FormData()
                                    form.append('field', 'form-value')
                                    const bodies = [
                                        ['string', 'small request'],
                                        ['form', form],
                                        ['blob', new Blob(['blob-value'], { type: 'text/plain' })],
                                        ['arraybuffer', new TextEncoder().encode('buffer-value').buffer],
                                        ['params', new URLSearchParams({ field: 'params-value' })],
                                        ['request', 'request-value'],
                                        ['request-init', 'override-value'],
                                        ['accessors', 'accessor-value'],
                                        ['large', null],
                                        ['chunked', null],
                                        ['delayed', null],
                                        ['binary', null],
                                        ['private', 'PRIVATE_BODY'],
                                        [
                                            'stream',
                                            new ReadableStream({
                                                start(controller) {
                                                    controller.enqueue(new TextEncoder().encode('stream-value'))
                                                    controller.close()
                                                },
                                            }),
                                        ],
                                    ]
                                    for (const [kind, body] of bodies) {
                                        const url = `${location.origin}/body?kind=${kind}`
                                        let input = url
                                        let init = body ? { method: 'POST', body } : undefined
                                        if (kind === 'private') init.headers = { authorization: 'PRIVATE_HEADER' }
                                        if (kind === 'stream') init.duplex = 'half'
                                        if (kind === 'request' || kind === 'request-init') {
                                            input = new Request(url, { method: 'POST', body: 'request-value' })
                                            if (kind === 'request') init = undefined
                                        }
                                        if (kind === 'accessors')
                                            init = Object.create({
                                                get method() {
                                                    return 'POST'
                                                },
                                                get body() {
                                                    return body
                                                },
                                                get signal() {
                                                    return new AbortController().signal
                                                },
                                            })
                                        const start = performance.now()
                                        try {
                                            const res = await fetch(input, init)
                                            const resolved = performance.now()
                                            const text = await res.text()
                                            samples.push({
                                                kind,
                                                fetchMs: resolved - start,
                                                bodyMs: performance.now() - start,
                                                text,
                                                status: res.status,
                                            })
                                        } catch (error) {
                                            samples.push({ kind, error: error.name })
                                        }
                                    }
                                    return samples
                                })
                                for (const sample of samples) {
                                    // A downstream wrapper forwarding Request.body is unsupported in WebKit
                                    // even natively; only that Request overload is an expected rejection.
                                    const unsupported =
                                        sample.kind === 'stream' ||
                                        (wrapper !== 'none' && ['request', 'request-init'].includes(sample.kind))
                                    if (unsupported)
                                        assert.equal(
                                            sample.error,
                                            engine === 'webkit' ? 'NotSupportedError' : 'TypeError'
                                        )
                                    else {
                                        assert.equal(sample.error, undefined, JSON.stringify(sample))
                                        assert.equal(sample.status, 200)
                                        if (sample.kind === 'large') assert.equal(sample.text.length, 1100000)
                                        if (sample.kind === 'request-init') assert.equal(sample.text, 'override-value')
                                        if (sample.kind === 'accessors') assert.equal(sample.text, 'accessor-value')
                                        if (sample.kind === 'form') assert(sample.text.includes('form-value'))
                                    }
                                }
                                // Gate the recorder's request clone, not the native upload. This exercises
                                // both clone readers even on WebKit (which has no native stream upload).
                                const requestURL = `${origin}/body?kind=request-gate`
                                await page.evaluate((url) => {
                                    const originalClone = Request.prototype.clone
                                    let release
                                    const gate = new Promise((resolve) => {
                                        release = resolve
                                    })
                                    window.releaseRequestGate = release
                                    Request.prototype.clone = function () {
                                        const clone = originalClone.call(this)
                                        if (this.url === url) {
                                            const text = clone.text.bind(clone)
                                            clone.text = () => gate.then(text)
                                            const getReader = clone.body.getReader.bind(clone.body)
                                            clone.body.getReader = () => {
                                                const reader = getReader()
                                                const read = reader.read.bind(reader)
                                                reader.read = () => gate.then(read)
                                                return reader
                                            }
                                        }
                                        return clone
                                    }
                                    window.requestGateFetch = fetch(url, { method: 'POST', body: 'request gate body' })
                                    Request.prototype.clone = originalClone
                                }, requestURL)
                                const dispatchedBeforeRequestRelease = await page.evaluate(async (url) => {
                                    for (let i = 0; i < 20; i++) await Promise.resolve()
                                    return !!window.dispatches[url]
                                }, requestURL)
                                await page.evaluate(() => window.releaseRequestGate())
                                assert.equal(
                                    await page.evaluate(async () => (await window.requestGateFetch).text()),
                                    'request gate body'
                                )
                                const expectDetached =
                                    arm === 'disabled' || process.env.REPLAY_FETCH_EXPECT_AWAITED !== '1'
                                if (dispatchedBeforeRequestRelease !== expectDetached)
                                    failures.push(
                                        `${engine}-${arm}-${streaming}-${wrapper}: native dispatch before request clone release: expected ${expectDetached}, got ${dispatchedBeforeRequestRelease}`
                                    )
                                // Real HTTP response gate: headers/first chunk delivered, remainder held until
                                // the test releases them. Compare promise ordering, not a latency budget.
                                const gate = `${engine}-${run}-${arm}-${streaming}-${wrapper}`
                                const url = `${origin}/body?gate=${gate}`
                                await page.evaluate((url) => {
                                    window.gatedFetch = fetch(url).then((res) => {
                                        window.hostSettled[url] = true
                                        return res
                                    })
                                }, url)
                                await page.waitForFunction((url) => window.headersSeen[url], url)
                                const settledBeforeRelease = await page.evaluate(async (url) => {
                                    // Drain the finite promise continuation chain without advancing the
                                    // recorder's 500ms body-read timeout or releasing the HTTP body gate.
                                    for (let i = 0; i < 20; i++) await Promise.resolve()
                                    return !!window.hostSettled[url]
                                }, url)
                                assert(gates.has(gate), 'server installed the body gate')
                                gates.get(gate)()
                                gates.delete(gate)
                                assert.equal(
                                    await page.evaluate(async () => (await window.gatedFetch).text()),
                                    'small response'
                                )
                                if (settledBeforeRelease !== expectDetached)
                                    failures.push(
                                        `${gate}: host resolution before body release: expected ${expectDetached}, got ${settledBeforeRelease}`
                                    )
                                const abortGate = `abort-${gate}`
                                const abortURL = `${origin}/body?gate=${abortGate}`
                                await page.evaluate((url) => {
                                    window.abortController = new AbortController()
                                    window.abortedBody = fetch(url, { signal: window.abortController.signal })
                                        .then((response) => response.text())
                                        .then(
                                            () => 'unexpected success',
                                            (error) => error.name
                                        )
                                }, abortURL)
                                await page.waitForFunction((url) => window.headersSeen[url], abortURL)
                                await page.evaluate(() => window.abortController.abort())
                                const abortRejection = await page.evaluate(() => window.abortedBody)
                                if (
                                    mode === 'benchmark' &&
                                    arm === 'candidate' &&
                                    process.env.REPLAY_FETCH_ALLOW_UNSAFE_CANDIDATE === '1'
                                ) {
                                    if (abortRejection !== 'AbortError')
                                        failures.push(
                                            `${abortGate}: UNSAFE candidate abort changed to ${abortRejection}`
                                        )
                                } else
                                    assert.equal(
                                        abortRejection,
                                        'AbortError',
                                        'aborting after native headers still rejects application body consumption'
                                    )
                                gates.get(abortGate)()
                                gates.delete(abortGate)
                                // Aborting before headers and cancelling the app's response stream must
                                // not become successful fetches or consume the app's body for recording.
                                const cancellation = await page.evaluate(async () => {
                                    const controller = new AbortController()
                                    controller.abort()
                                    let rejection
                                    try {
                                        await fetch('/body?kind=abort', { signal: controller.signal })
                                    } catch (error) {
                                        rejection = error.name
                                    }
                                    const response = await fetch('/body?kind=cancel')
                                    await response.body.cancel()
                                    return { rejection, bodyUsed: response.bodyUsed }
                                })
                                assert.equal(cancellation.rejection, 'AbortError')
                                assert.equal(cancellation.bodyUsed, true)
                                await page.waitForFunction(
                                    (arm) =>
                                        window.entries.some(
                                            (e) =>
                                                e.name.includes('kind=private') &&
                                                (arm === 'disabled' || e.responseBody === 'redacted')
                                        ),
                                    arm
                                )
                                // Performance timing lookup can wait up to 3 seconds after cancellation.
                                if (arm !== 'disabled')
                                    await page.waitForFunction(() =>
                                        window.entries.some((e) => e.name.includes('kind=cancel') && e.responseBody)
                                    )
                                await page.waitForFunction(
                                    (kinds) =>
                                        kinds.every((kind) =>
                                            window.entries.some((e) => e.name.includes(`kind=${kind}`))
                                        ),
                                    [...samples.filter((s) => !s.error).map((s) => s.kind), 'request-gate']
                                )
                                const recorded = await page.evaluate(() => ({
                                    entries: window.entries,
                                    longTasks: window.longTasks,
                                    longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
                                }))
                                const fixtureEntries = recorded.entries.filter((e) => e.name.includes('/body'))
                                assert(
                                    !JSON.stringify(fixtureEntries).includes('PRIVATE_'),
                                    'private values absent in emitted rrweb network events'
                                )
                                if (arm !== 'disabled') {
                                    const requestGateEntry = fixtureEntries.find((e) => e.name === requestURL)
                                    assert.equal(requestGateEntry?.requestBody, 'request gate body')
                                    assert.equal(requestGateEntry?.responseBody, 'request gate body')
                                    for (const sample of samples.filter((s) => !s.error)) {
                                        const entry = fixtureEntries.find((e) => e.name.includes(`kind=${sample.kind}`))
                                        assert(entry, `missing ${sample.kind}`)
                                        assert.equal(
                                            fixtureEntries.filter(
                                                (e) =>
                                                    new URL(e.name).searchParams.get('kind') === sample.kind &&
                                                    !e.isInitial
                                            ).length,
                                            1,
                                            `one complete ${sample.kind} event`
                                        )
                                        if (
                                            [
                                                'string',
                                                'blob',
                                                'arraybuffer',
                                                'params',
                                                'request',
                                                'request-init',
                                                'accessors',
                                            ].includes(sample.kind)
                                        )
                                            assert.equal(
                                                entry.requestBody,
                                                sample.text,
                                                `complete ${sample.kind} request`
                                            )
                                        if (sample.kind === 'form') {
                                            assert(entry.requestBody.includes('name="field"'))
                                            assert(entry.requestBody.includes('form-value'))
                                        }
                                        if (sample.kind === 'private') assert.equal(entry.responseBody, 'redacted')
                                        else if (
                                            sample.kind === 'chunked' &&
                                            entry.responseHeaders['transfer-encoding'] === 'chunked'
                                        )
                                            assert.equal(
                                                entry.responseBody,
                                                'Chunked Transfer-Encoding is not supported'
                                            )
                                        else if (sample.kind === 'binary') assert.equal(entry.responseBody, undefined)
                                        else if (sample.kind === 'large' && streaming)
                                            assert.equal(
                                                entry.responseBody,
                                                '[SessionReplay] Body too large to record (> 1000000 bytes)'
                                            )
                                        else
                                            assert.equal(
                                                entry.responseBody,
                                                sample.text,
                                                `complete ${sample.kind} response`
                                            )
                                    }
                                } else
                                    assert(
                                        fixtureEntries.every(
                                            (e) =>
                                                !e.requestBody &&
                                                !e.responseBody &&
                                                !e.requestHeaders &&
                                                !e.responseHeaders
                                        )
                                    )
                                assert.deepEqual(errors, [], 'no telemetry-induced unhandled errors')
                                const afterCPU = cpu ? await cpu.send('Performance.getMetrics') : null
                                const taskDuration = (metrics) =>
                                    metrics.metrics.find((m) => m.name === 'TaskDuration').value
                                results.push({
                                    engine,
                                    run,
                                    arm,
                                    streaming,
                                    wrapper,
                                    settledBeforeRelease,
                                    dispatchedBeforeRequestRelease,
                                    samples: samples.map(({ text, ...sample }) => ({ ...sample, bytes: text?.length })),
                                    recorderEntries: fixtureEntries.length,
                                    recorderBytes: Buffer.byteLength(JSON.stringify(fixtureEntries)),
                                    longTaskSupported: recorded.longTaskSupported,
                                    longTasks: recorded.longTasks,
                                    taskDurationMs: cpu
                                        ? 1000 * (taskDuration(afterCPU) - taskDuration(beforeCPU))
                                        : null,
                                })
                            } finally {
                                await context.close()
                            }
                        }
                    }
                }
            }
        } finally {
            await browser.close()
        }
    }
} finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await writeFile(path.join(output, 'samples.json'), JSON.stringify({ mode, results, failures }, null, 2))
}
const percentile = (values, p) => values.sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
const summary = []
for (const engine of engines)
    for (const arm of arms)
        for (const streaming of [false, true])
            for (const wrapper of wrappers) {
                const selected = results.filter(
                    (r) => r.engine === engine && r.arm === arm && r.streaming === streaming && r.wrapper === wrapper
                )
                if (cancellationOnly && selected.length) {
                    const metrics = {
                        responseMs: selected.map((r) => r.final.responseMs),
                        cancelFromInvocationMs: selected.map((r) => r.final.cancelMs),
                        cancelFromResponseMs: selected.map((r) => r.final.cancelMs - r.final.responseMs),
                    }
                    summary.push({
                        engine,
                        arm,
                        streaming,
                        wrapper,
                        kind: 'cancellation',
                        n: selected.length,
                        metrics: Object.fromEntries(
                            Object.entries(metrics).map(([name, values]) => [
                                name,
                                { median: percentile([...values], 0.5), p95: percentile([...values], 0.95) },
                            ])
                        ),
                    })
                }
                if (!cancellationOnly && !abortOnly && selected.length) {
                    const metrics = {
                        recorderEntries: selected.map((r) => r.recorderEntries),
                        recorderBytes: selected.map((r) => r.recorderBytes),
                        ...(selected[0].longTaskSupported
                            ? {
                                  longTaskDurationMs: selected.map((r) =>
                                      r.longTasks.reduce((sum, value) => sum + value, 0)
                                  ),
                                  longTaskCount: selected.map((r) => r.longTasks.length),
                              }
                            : {}),
                        ...(selected[0].taskDurationMs !== null
                            ? { taskDurationMs: selected.map((r) => r.taskDurationMs) }
                            : {}),
                    }
                    summary.push({
                        engine,
                        arm,
                        streaming,
                        wrapper,
                        kind: 'recorder-overhead',
                        n: selected.length,
                        metrics: Object.fromEntries(
                            Object.entries(metrics).map(([name, values]) => [
                                name,
                                { median: percentile([...values], 0.5), p95: percentile([...values], 0.95) },
                            ])
                        ),
                    })
                }
                for (const kind of new Set(selected.flatMap((r) => r.samples.map((s) => s.kind)))) {
                    const samples = selected.flatMap((r) => r.samples.filter((s) => s.kind === kind && !s.error))
                    if (!samples.length) continue
                    summary.push({
                        engine,
                        arm,
                        streaming,
                        wrapper,
                        kind,
                        n: samples.length,
                        fetchMedianMs: percentile(
                            samples.map((s) => s.fetchMs),
                            0.5
                        ),
                        fetchP95Ms: percentile(
                            samples.map((s) => s.fetchMs),
                            0.95
                        ),
                        bodyMedianMs: percentile(
                            samples.map((s) => s.bodyMs),
                            0.5
                        ),
                        bodyP95Ms: percentile(
                            samples.map((s) => s.bodyMs),
                            0.95
                        ),
                    })
                }
            }
await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2))
if (mode === 'correctness')
    assert.deepEqual(failures, [], 'fetch ordering and native abort semantics must match the selected contract')
// oxlint-disable-next-line no-console -- Node CLI result summary
console.log(`${mode}: ${results.length} cases, ${failures.length} contract violations; artifacts in ${output}`)
