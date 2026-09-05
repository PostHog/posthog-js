// Opt-in end-to-end benchmark for #4217. See benchmark-replay.md.
// Node CLI + installed Playwright Chromium, not an SDK runtime bundle.
// oxlint-disable compat/compat
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { chromium } from '@playwright/test'
import { isArray } from '@posthog/core'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const output = path.resolve(process.env.REPLAY_BENCH_OUTPUT || path.join(packageRoot, 'test-results/replay-benchmark'))
const distRoot = path.resolve(process.env.REPLAY_BENCH_DIST || path.join(packageRoot, 'dist'))
const sizes = (process.env.REPLAY_BENCH_NODES || '10000,50000,100000').split(',').map(Number)
const repetitions = Number(process.env.REPLAY_BENCH_RUNS || 3)
const cpuRate = Number(process.env.REPLAY_BENCH_CPU || 1)
const shapes = (process.env.REPLAY_BENCH_SHAPES || 'table,css').split(',')
const profiling = process.env.REPLAY_BENCH_PROFILE === '1'
assert(sizes.every((n) => Number.isInteger(n) && n > 0))
assert(Number.isInteger(repetitions) && repetitions > 0)
assert(Number.isFinite(cpuRate) && cpuRate >= 1)
assert(shapes.every((shape) => ['table', 'css'].includes(shape)))

const assets = new Map()
for (const name of ['array.js', 'posthog-recorder.js']) {
    assets.set(name, await readFile(path.join(distRoot, name)))
}
const replayer = await readFile(path.join(packageRoot, '../rrweb/rrweb/dist/rrweb.umd.cjs'), 'utf8')
const origin = 'https://replay-benchmark.test'
const markerTag = 'replay-benchmark-end'
const privateValues = ['BENCH_PRIVATE_INPUT', 'BENCH_PRIVATE_TEXT', 'BENCH_BLOCKED_TEXT']

function decodeRequest(request) {
    const bytes = request.postDataBuffer()
    if (!bytes) return []
    const url = new URL(request.url())
    const text = url.searchParams.get('compression') === 'gzip-js' ? gunzipSync(bytes).toString() : bytes.toString()
    const parsed =
        text.startsWith('{') || text.startsWith('[')
            ? JSON.parse(text)
            : JSON.parse(Buffer.from(new URLSearchParams(text).get('data'), 'base64').toString())
    return isArray(parsed) ? parsed : [parsed]
}

function decodeSnapshot(event) {
    if (event.cv !== '2024-10') return event
    const unzip = (s) => JSON.parse(gunzipSync(Buffer.from(s, 'latin1')).toString())
    if (event.type === 2) return { ...event, data: unzip(event.data) }
    const data = { ...event.data }
    for (const key of ['adds', 'removes', 'texts', 'attributes']) {
        if (typeof data[key] === 'string') data[key] = unzip(data[key])
    }
    return { ...event, data }
}

function countSnapshotNodes(root) {
    let count = 0
    const ids = new Set()
    const stack = [root]
    while (stack.length) {
        const node = stack.pop()
        assert(!ids.has(node.id), `duplicate full-snapshot id: ${node.id}`)
        ids.add(node.id)
        count++
        for (const child of node.childNodes || []) stack.push(child)
    }
    return count
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const results = []
try {
    for (const shape of shapes)
        for (const targetNodes of sizes)
            for (let run = 0; run < repetitions; run++) {
                // Alternate arm order to avoid always giving the same arm a warm browser process.
                for (const compress of run % 2 ? [true, false] : [false, true]) {
                    const context = await browser.newContext()
                    const page = await context.newPage()
                    const client = await context.newCDPSession(page)
                    await client.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
                    await client.send('Performance.enable')
                    const label = `${shape}-${targetNodes}-${run}-${compress ? 'gzip' : 'plain'}`
                    const wireEvents = []
                    const receivedMarkers = new Map()
                    let requestBytes = 0
                    let decodeError
                    await context.route('**/*', async (route) => {
                        const request = route.request()
                        const url = new URL(request.url())
                        const asset = assets.get(path.basename(url.pathname))
                        if (url.origin !== origin) return route.abort()
                        if (asset) return route.fulfill({ contentType: 'application/javascript', body: asset })
                        if (url.pathname === '/')
                            return route.fulfill({
                                contentType: 'text/html',
                                body: '<!doctype html><html><head></head><body><button id="activity">activity</button><main id="fixture"></main><aside id="destination"></aside></body></html>',
                            })
                        if (url.pathname.includes('/config') || url.pathname.startsWith('/flags/')) {
                            return route.fulfill({
                                json: {
                                    featureFlags: {},
                                    flags: {},
                                    sessionRecording: { endpoint: '/ses/' },
                                    supportedCompression: [],
                                },
                            })
                        }
                        if (url.pathname.startsWith('/ses/')) {
                            try {
                                requestBytes += request.postDataBuffer()?.length || 0
                                for (const envelope of decodeRequest(request)) {
                                    for (const raw of envelope.properties?.$snapshot_data || []) {
                                        const event = decodeSnapshot(raw)
                                        wireEvents.push(event)
                                        if (event.type === 5 && event.data.tag === markerTag) {
                                            receivedMarkers.set(event.data.payload, request.timing().startTime)
                                        }
                                    }
                                }
                            } catch (error) {
                                decodeError = error
                            }
                        }
                        return route.fulfill({ json: { status: 1 } })
                    })
                    try {
                        await page.goto(origin)
                        // Preload exact local artifacts: network/module loading is not serializer time.
                        await page.addScriptTag({ url: `${origin}/static/array.js` })
                        await page.addScriptTag({ url: `${origin}/static/posthog-recorder.js` })
                        await page.evaluate(
                            ({ targetNodes, shape, compress, origin }) => {
                                const fixture = document.getElementById('fixture')
                                const rowCount = Math.ceil(targetNodes / 21)
                                const cell = '<span class="cell" data-label="metric"><b>12</b><i>label</i></span>'
                                const markup = Array.from(
                                    { length: rowCount },
                                    (_, i) => `<div data-row="${i}">${cell.repeat(4)}</div>`
                                ).join('')
                                let generation = 0
                                window.buildFixture = () => {
                                    generation++
                                    fixture.innerHTML =
                                        markup.replaceAll('>12<', `>${generation}<`) +
                                        '<input type="password" value="BENCH_PRIVATE_INPUT"><span class="ph-mask">BENCH_PRIVATE_TEXT</span><div class="ph-no-capture">BENCH_BLOCKED_TEXT</div>'
                                }
                                window.buildFixture()
                                if (shape === 'css') {
                                    const style = document.createElement('style')
                                    style.id = 'benchmark-css'
                                    document.head.append(style)
                                    // Deliberately CSSOM-only: covers the non-deferrable stylesheet bucket.
                                    for (let i = 0; i < 10000; i++)
                                        style.sheet.insertRule(`.rule${i} { color: rgb(${i % 255}, 0, 0); }`)
                                    const adopted = new CSSStyleSheet()
                                    adopted.replaceSync('.cell { padding: var(--space, 1px); }')
                                    document.adoptedStyleSheets = [adopted]
                                }
                                window.posthog.init('replay-benchmark', {
                                    api_host: origin,
                                    disable_session_recording: true,
                                    opt_out_useragent_filter: true,
                                    capture_pageview: false,
                                    capture_pageleave: false,
                                    autocapture: false,
                                    disable_surveys: true,
                                    request_batching: false,
                                    disable_compression: true,
                                    session_recording: {
                                        compress_events: compress,
                                        recordConsole: false,
                                        recordNetwork: false,
                                    },
                                })
                            },
                            { targetNodes, shape, compress, origin }
                        )
                        await page.waitForFunction(
                            () =>
                                window.posthog.sessionRecording?.status === 'disabled' &&
                                window.posthog.featureFlags.hasLoadedFlags
                        )
                        const metrics = []
                        const checkpoints = []
                        for (const phase of ['off-rebuild', 'start', 'snapshot', 'rebuild', 'move', 'remove']) {
                            const startIndex = wireEvents.length
                            const bytesBefore = requestBytes
                            const before = await client.send('Performance.getMetrics')
                            if (profiling) {
                                await client.send('Profiler.enable')
                                await client.send('Profiler.start')
                            }
                            const timing = await page.evaluate(
                                ({ phase, markerTag }) =>
                                    new Promise((resolve) => {
                                        const record = window.__PosthogExtensions__.rrweb.record
                                        const longTasks = []
                                        const observer = new PerformanceObserver((list) => {
                                            for (const e of list.getEntries())
                                                longTasks.push({ start: e.startTime, duration: e.duration })
                                        })
                                        observer.observe({ type: 'longtask' })
                                        let raf,
                                            lastFrame = 0,
                                            maxFrameGapMs = 0,
                                            actionStart = Infinity
                                        const tick = (now) => {
                                            if (lastFrame > 0 && now >= actionStart)
                                                maxFrameGapMs = Math.max(maxFrameGapMs, now - lastFrame)
                                            lastFrame = now
                                            raf = requestAnimationFrame(tick)
                                        }
                                        raf = requestAnimationFrame(tick)
                                        // CDP evaluate work can be invisible to Long Tasks API. Use a page task.
                                        setTimeout(() => {
                                            const start = performance.now()
                                            actionStart = start
                                            const epochStart = performance.timeOrigin + start
                                            switch (phase) {
                                                case 'off-rebuild':
                                                case 'rebuild':
                                                    window.buildFixture()
                                                    break
                                                case 'start':
                                                    window.posthog.startSessionRecording()
                                                    document.getElementById('activity').click()
                                                    break
                                                case 'snapshot':
                                                    record.takeFullSnapshot()
                                                    break
                                                case 'move':
                                                    document
                                                        .getElementById('destination')
                                                        .append(document.getElementById('fixture'))
                                                    break
                                                case 'remove':
                                                    document.getElementById('fixture').replaceChildren()
                                                    break
                                            }
                                            const actionMs = performance.now() - start
                                            // Observer delivery happens before this timer. The marker passes through
                                            // the real SDK compression queue, buffer, request encoder and transport.
                                            setTimeout(() => {
                                                if (phase !== 'off-rebuild') record.addCustomEvent(markerTag, phase)
                                                window.finishMeasurement = () => {
                                                    observer.disconnect()
                                                    cancelAnimationFrame(raf)
                                                    return {
                                                        maxFrameGapMs,
                                                        longTasks: longTasks.filter((t) => t.start >= start - 1),
                                                        debug: window.posthog.sessionRecording.sdkDebugProperties,
                                                    }
                                                }
                                                resolve({ epochStart, actionMs })
                                            }, 0)
                                        }, 50)
                                    }),
                                { phase, markerTag }
                            )
                            if (phase !== 'off-rebuild') {
                                const deadline = Date.now() + 30000
                                while (!receivedMarkers.has(phase) && !decodeError && Date.now() < deadline)
                                    await new Promise((r) => setTimeout(r, 25))
                                if (decodeError) throw decodeError
                                assert(
                                    receivedMarkers.has(phase),
                                    `${label}/${phase}: end marker did not reach transport`
                                )
                            }
                            // Allow trailing PerformanceObserver entries to arrive, outside the action.
                            await page.waitForTimeout(100)
                            const observation = await page.evaluate(() => window.finishMeasurement())
                            const after = await client.send('Performance.getMetrics')
                            if (profiling) {
                                const { profile } = await client.send('Profiler.stop')
                                await writeFile(
                                    path.join(output, `${label}-${phase}.cpuprofile`),
                                    JSON.stringify(profile)
                                )
                            }
                            const metric = (data, name) => data.metrics.find((m) => m.name === name)?.value || 0
                            const events = wireEvents.slice(startIndex)
                            const fullSnapshots = events.filter((e) => e.type === 2)
                            const mutations = events.filter((e) => e.type === 3 && e.data.source === 0)
                            if (phase === 'start' || phase === 'snapshot') assert.equal(fullSnapshots.length, 1)
                            const previousDebug = metrics.at(-1)?.debug || {}
                            const counterDelta = (key) => (observation.debug[key] || 0) - (previousDebug[key] || 0)
                            const serialized = JSON.stringify(events)
                            for (const secret of privateValues)
                                assert(!serialized.includes(secret), `${phase}: privacy sentinel reached wire`)
                            metrics.push({
                                phase,
                                ...timing,
                                wireMs: phase === 'off-rebuild' ? null : receivedMarkers.get(phase) - timing.epochStart,
                                maxTaskMs: Math.max(0, ...observation.longTasks.map((t) => t.duration)),
                                longTaskCount: observation.longTasks.length,
                                maxFrameGapMs: observation.maxFrameGapMs,
                                taskCpuMs: 1000 * (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')),
                                heapDeltaBytes: metric(after, 'JSHeapUsedSize') - metric(before, 'JSHeapUsedSize'),
                                wireBytes: requestBytes - bytesBefore,
                                fullSnapshots: fullSnapshots.map((e) => countSnapshotNodes(e.data.node)),
                                unexpectedFullSnapshots: Math.max(
                                    0,
                                    fullSnapshots.length - (['start', 'snapshot'].includes(phase) ? 1 : 0)
                                ),
                                oversizedMutationsDropped: counterDelta(
                                    '$sdk_debug_replay_oversized_mutations_dropped'
                                ),
                                throttledAttributesDropped: counterDelta(
                                    '$sdk_debug_replay_throttled_mutations_dropped'
                                ),
                                adds: mutations.reduce((sum, e) => sum + e.data.adds.length, 0),
                                removes: mutations.reduce((sum, e) => sum + e.data.removes.length, 0),
                                debug: observation.debug,
                            })
                            if (phase !== 'off-rebuild') checkpoints.push({ phase, end: wireEvents.length })
                        }
                        // Correctness validation is deliberately outside all measurement windows.
                        await page.evaluate(() => window.posthog.stopSessionRecording())
                        await page.addScriptTag({ content: replayer })
                        for (const { phase, end } of checkpoints) {
                            // Check intermediate states too: an empty final tree can hide lost adds.
                            const generation = ['start', 'snapshot'].includes(phase) ? 2 : 3
                            const replayed = await page.evaluate(
                                ({ events, generation, shape }) => {
                                    const player = new window.rrweb.Replayer(events, { UNSAFE_replayCanvas: false })
                                    player.pause(events.at(-1).timestamp - events[0].timestamp + 1)
                                    const doc = player.iframe.contentDocument
                                    const fixture = doc.querySelector('#fixture')
                                    const rows = [...doc.querySelectorAll('#fixture [data-row]')]
                                    const cssRules = doc.getElementById('benchmark-css')?.sheet.cssRules
                                    const result = {
                                        fixtureCount: doc.querySelectorAll('#fixture').length,
                                        parent: fixture?.parentElement.id,
                                        rows: rows.length,
                                        orderedContent: rows.every(
                                            (row, i) =>
                                                row.getAttribute('data-row') === String(i) &&
                                                row.textContent === `${generation}label`.repeat(4) &&
                                                row.querySelectorAll('.cell[data-label="metric"]').length === 4
                                        ),
                                        stylesheet:
                                            shape !== 'css' ||
                                            (cssRules?.length === 10000 &&
                                                cssRules[0].selectorText === '.rule9999' &&
                                                cssRules[9999].selectorText === '.rule0'),
                                        adoptedStyle:
                                            shape !== 'css' ||
                                            rows.length === 0 ||
                                            doc.defaultView.getComputedStyle(rows[0].querySelector('.cell'))
                                                .paddingLeft === '1px',
                                    }
                                    player.destroy()
                                    return result
                                },
                                { events: wireEvents.slice(0, end), generation, shape }
                            )
                            assert.deepEqual(
                                replayed,
                                {
                                    fixtureCount: 1,
                                    parent: ['move', 'remove'].includes(phase) ? 'destination' : '',
                                    rows: phase === 'remove' ? 0 : Math.ceil(targetNodes / 21),
                                    orderedContent: true,
                                    stylesheet: true,
                                    adoptedStyle: true,
                                },
                                `${label}/${phase}: replay did not reconstruct the fixture`
                            )
                        }
                        const result = { label, shape, targetNodes, run, compress, metrics }
                        results.push(result)
                        await writeFile(path.join(output, `${label}.json`), JSON.stringify(result, null, 2))
                        // oxlint-disable-next-line no-console
                        console.log(
                            label,
                            metrics
                                .map(
                                    (m) =>
                                        `${m.phase}: task=${m.maxTaskMs.toFixed(0)}ms cpu=${m.taskCpuMs.toFixed(0)}ms adds=${m.adds} oversizedDropped=${m.oversizedMutationsDropped} attributesDropped=${m.throttledAttributesDropped} extraSnapshots=${m.unexpectedFullSnapshots}`
                                )
                                .join(' | ')
                        )
                    } finally {
                        await context.close()
                    }
                }
            }
} finally {
    await writeFile(
        path.join(output, 'results.json'),
        JSON.stringify(
            {
                revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: packageRoot, encoding: 'utf8' }).trim(),
                dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: packageRoot, encoding: 'utf8' }).trim(),
                artifacts: Object.fromEntries(
                    [...assets].map(([name, data]) => [name, createHash('sha256').update(data).digest('hex')])
                ),
                browser: browser.version(),
                node: process.version,
                platform: `${os.platform()} ${os.arch()}`,
                cpu: os.cpus()[0]?.model,
                cpuRate,
                profiling,
                results,
            },
            null,
            2
        )
    )
    await browser.close()
}
