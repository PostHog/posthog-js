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
const preprocessingWorkloads = process.env.REPLAY_BENCH_PREPROCESSING === '1'
const orderingWorkloads = preprocessingWorkloads || process.env.REPLAY_BENCH_ORDERING === '1'
const mirrorCounters = orderingWorkloads && profiling && process.env.REPLAY_BENCH_MIRROR_COUNTERS !== '0'
const layoutCounters = process.env.REPLAY_BENCH_LAYOUT_COUNTERS === '1'
assert(!layoutCounters || profiling, 'Layout counters require profiling')
const depth = Number(process.env.REPLAY_BENCH_DEPTH || 32)
assert(Number.isInteger(depth) && depth >= 1 && depth <= 128)
const mutationWorkloads = orderingWorkloads || process.env.REPLAY_BENCH_MUTATIONS === '1'
const moveRounds = Number(process.env.REPLAY_BENCH_MOVE_ROUNDS || 5)
assert(Number.isInteger(moveRounds) && moveRounds >= 0 && moveRounds <= 20)
const churnSteps = Number(process.env.REPLAY_BENCH_CHURN_STEPS || 5)
const compression = process.env.REPLAY_BENCH_COMPRESSION || 'both'
assert(Number.isInteger(churnSteps) && churnSteps > 0 && churnSteps <= 20)
assert(['on', 'off', 'both'].includes(compression))
assert(sizes.every((n) => Number.isInteger(n) && n > 0))
assert(Number.isInteger(repetitions) && repetitions > 0)
assert(Number.isFinite(cpuRate) && cpuRate >= 1)
assert(shapes.every((shape) => ['table', 'css', 'shadow', 'flat', 'deep'].includes(shape)))

const assets = new Map()
for (const name of ['array.js', 'posthog-recorder.js']) {
    assets.set(name, await readFile(path.join(distRoot, name)))
}
const preprocessingProbe = await readFile(path.join(distRoot, 'mutation-probe.json'), 'utf8')
    .then(JSON.parse)
    .catch((error) => {
        if (error.code === 'ENOENT') return null
        throw error
    })
assert(!preprocessingProbe || profiling, 'Instrumented probe artifacts require REPLAY_BENCH_PROFILE=1')
const replayer = await readFile(path.join(packageRoot, '../rrweb/rrweb/dist/rrweb.umd.cjs'), 'utf8')
const origin = 'https://replay-benchmark.test'
const markerTag = 'replay-benchmark-end'
const privateValues = ['BENCH_PRIVATE_INPUT', 'BENCH_PRIVATE_TEXT', 'BENCH_BLOCKED_TEXT', 'BENCH_TRANSIENT_PRIVATE']

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
                for (const compress of (run % 2 ? [true, false] : [false, true]).filter(
                    (value) => compression === 'both' || value === (compression === 'on')
                )) {
                    const context = await browser.newContext()
                    const heapTimers = []
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
                        assert.equal(
                            await page.evaluate(() => !!window.__rrwebMutationProbe),
                            !!preprocessingProbe,
                            'Probe manifest does not match loaded recorder'
                        )
                        await page.evaluate(
                            ({ targetNodes, shape, compress, origin, depth }) => {
                                const fixture = document.getElementById('fixture')
                                window.benchmarkFixture = fixture
                                const rowCount = Math.ceil(targetNodes / (shape === 'flat' ? 2 : 21))
                                const lightRows = shape === 'shadow' ? Math.floor(rowCount / 2) : rowCount
                                const cell = '<span class="cell" data-label="metric"><b>12</b><i>label</i></span>'
                                const markup = Array.from(
                                    { length: lightRows },
                                    (_, i) => `<div data-row="${i}">${shape === 'flat' ? '12' : cell.repeat(4)}</div>`
                                ).join('')
                                let generation = 0
                                window.buildFixture = (nested = false) => {
                                    generation++
                                    window.fixtureGeneration = generation
                                    window.fixtureReversed = false
                                    window.maskedRowId = null
                                    window.mixedAttribute = null
                                    if (nested) {
                                        fixture.replaceChildren()
                                        for (let i = 0; i < lightRows; i++) {
                                            const row = document.createElement('div')
                                            row.dataset.row = String(i)
                                            fixture.append(row)
                                            // Both parent insertion and its connected child insertion are observed.
                                            row.innerHTML =
                                                shape === 'flat'
                                                    ? String(generation)
                                                    : cell.repeat(4).replaceAll('>12<', `>${generation}<`)
                                        }
                                    } else {
                                        fixture.innerHTML = markup.replaceAll('>12<', `>${generation}<`)
                                    }
                                    const sentinels =
                                        '<input type="password" value="BENCH_PRIVATE_INPUT"><span class="ph-mask">BENCH_PRIVATE_TEXT</span><div class="ph-no-capture">BENCH_BLOCKED_TEXT</div>'
                                    fixture.insertAdjacentHTML('beforeend', sentinels)
                                    if (shape === 'deep') {
                                        const rows = [...fixture.querySelectorAll('[data-row]')]
                                        let parent = fixture
                                        for (let i = 0; i < depth; i++) {
                                            const wrapper = document.createElement('div')
                                            wrapper.dataset.benchmarkDepth = String(i)
                                            parent.append(wrapper)
                                            parent = wrapper
                                        }
                                        parent.id = 'deep-rows'
                                        rows.forEach((row) => parent.append(row))
                                    }
                                    if (shape === 'shadow') {
                                        const host = document.createElement('div')
                                        host.id = 'benchmark-shadow'
                                        fixture.append(host)
                                        const shadow = host.attachShadow({ mode: 'open' })
                                        shadow.innerHTML =
                                            Array.from(
                                                { length: rowCount - lightRows },
                                                (_, i) => `<div data-row="${i + lightRows}">${cell.repeat(4)}</div>`
                                            )
                                                .join('')
                                                .replaceAll('>12<', `>${generation}<`) + sentinels
                                    }
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
                            { targetNodes, shape, compress, origin, depth }
                        )
                        await page.waitForFunction(
                            () =>
                                window.posthog.sessionRecording?.status === 'disabled' &&
                                window.posthog.featureFlags.hasLoadedFlags
                        )
                        await page.exposeBinding('requestBenchmarkInput', async () => {
                            const timestamp = Date.now() / 1000
                            await Promise.all([
                                client.send('Input.dispatchMouseEvent', {
                                    type: 'mousePressed',
                                    x: 20,
                                    y: 18,
                                    button: 'left',
                                    buttons: 1,
                                    clickCount: 1,
                                    timestamp,
                                }),
                                client.send('Input.dispatchMouseEvent', {
                                    type: 'mouseReleased',
                                    x: 20,
                                    y: 18,
                                    button: 'left',
                                    buttons: 0,
                                    clickCount: 1,
                                    timestamp,
                                }),
                            ])
                        })
                        if (mirrorCounters)
                            await page.evaluate(() => {
                                const mirror = window.__PosthogExtensions__.rrweb.record.mirror
                                let seen,
                                    depth = 0
                                window.resetMirrorStats = () => {
                                    seen = new WeakSet()
                                    window.mirrorStats = { removeVisits: 0, distinctRemovedNodes: 0, removeRoots: 0 }
                                }
                                window.resetMirrorStats()
                                for (const method of ['getId', 'getMeta', 'getNode', 'has', 'hasNode', 'add']) {
                                    const original = mirror[method]
                                    mirror[method] = function (...args) {
                                        window.mirrorStats[method] = (window.mirrorStats[method] || 0) + 1
                                        return original.apply(this, args)
                                    }
                                }
                                const remove = mirror.removeNodeFromMap
                                mirror.removeNodeFromMap = function (node) {
                                    const stats = window.mirrorStats
                                    stats.removeVisits++
                                    if (!depth) stats.removeRoots++
                                    if (!seen.has(node)) {
                                        seen.add(node)
                                        stats.distinctRemovedNodes++
                                    }
                                    depth++
                                    try {
                                        return remove.call(this, node)
                                    } finally {
                                        depth--
                                    }
                                }
                            })
                        const metrics = []
                        const checkpoints = []
                        if (layoutCounters)
                            await page.evaluate(() => {
                                const original = Element.prototype.getBoundingClientRect
                                window.resetLayoutStats = () => {
                                    window.layoutStats = { calls: 0, distinctNodes: 0, elapsedMs: 0 }
                                    window.layoutSeen = new WeakSet()
                                }
                                window.resetLayoutStats()
                                Element.prototype.getBoundingClientRect = function (...args) {
                                    const stats = window.layoutStats
                                    stats.calls++
                                    if (!window.layoutSeen.has(this)) {
                                        window.layoutSeen.add(this)
                                        stats.distinctNodes++
                                    }
                                    const start = performance.now()
                                    try {
                                        return original.apply(this, args)
                                    } finally {
                                        stats.elapsedMs += performance.now() - start
                                    }
                                }
                            })
                        const phases = preprocessingWorkloads
                            ? ['off-repeat-move', 'off-mixed-move', 'start', 'repeat-move', 'mixed-move', 'remove']
                            : orderingWorkloads
                              ? [
                                    'off-remove',
                                    'off-subtree-remove',
                                    'off-repeat-move',
                                    'off-reorder',
                                    'start',
                                    'reorder',
                                    'repeat-move',
                                    'subtree-remove',
                                    'restore',
                                    'remove',
                                ]
                              : mutationWorkloads
                                ? [
                                      'off-rebuild',
                                      'off-nested',
                                      'off-churn',
                                      'off-move',
                                      'off-remove',
                                      'start',
                                      'snapshot',
                                      'rebuild',
                                      'nested',
                                      'churn',
                                      'move',
                                      'remove',
                                  ]
                                : ['off-rebuild', 'start', 'snapshot', 'rebuild', 'move', 'remove']
                        for (const phase of phases) {
                            const off = phase.startsWith('off-')
                            if (mutationWorkloads && (off || phase === 'start')) {
                                await page.evaluate(() => {
                                    document.body.insertBefore(
                                        document.getElementById('fixture') || window.benchmarkFixture,
                                        document.getElementById('destination')
                                    )
                                    window.buildFixture()
                                })
                                await page.waitForTimeout(100)
                            }
                            if (mirrorCounters) await page.evaluate(() => window.resetMirrorStats())
                            if (layoutCounters) await page.evaluate(() => window.resetLayoutStats())
                            if (preprocessingProbe) await page.evaluate(() => window.__rrwebMutationProbe.reset())
                            const startIndex = wireEvents.length
                            const bytesBefore = requestBytes
                            const before = await client.send('Performance.getMetrics')
                            const heapSamples = []
                            let heapTimer, heapPending, heapError
                            if (profiling) {
                                await client.send('Profiler.enable')
                                await client.send('Profiler.start')
                                // Diagnostic runs only: these samples perturb timing and can miss transient peaks.
                                heapTimer = setInterval(() => {
                                    if (heapPending) return
                                    heapPending = client
                                        .send('Runtime.getHeapUsage')
                                        .then((sample) => heapSamples.push(sample.usedSize))
                                        .catch((error) => {
                                            heapError = error
                                        })
                                        .finally(() => {
                                            heapPending = undefined
                                        })
                                }, 100)
                                heapTimers.push(heapTimer)
                            }
                            const timing = await page.evaluate(
                                ({ phase, markerTag, mutationWorkloads, churnSteps, moveRounds, off }) =>
                                    new Promise((resolve, reject) => {
                                        const deadline = setTimeout(
                                            () => reject(new Error(`${phase}: workload timed out`)),
                                            120000
                                        )
                                        const record = window.__PosthogExtensions__.rrweb.record
                                        const definitions = []
                                        const checkpoint = (marker) => {
                                            const fixture = document.getElementById('fixture')
                                            definitions.push({
                                                phase: marker,
                                                generation: window.fixtureGeneration,
                                                reversed: window.fixtureReversed,
                                                maskedRowId: window.maskedRowId,
                                                mixedAttribute: window.mixedAttribute,
                                                present: !!fixture,
                                                parent: fixture?.parentElement.id ?? null,
                                                empty: !fixture?.childNodes.length,
                                            })
                                            if (!off) record.addCustomEvent(markerTag, marker)
                                        }
                                        const inputDelays = []
                                        const onInput = (event) => {
                                            if (!event.isTrusted) return
                                            inputDelays.push(performance.now() - event.timeStamp)
                                            checkpoint(`${phase}-input`)
                                        }
                                        if (mutationWorkloads) {
                                            // oxlint-disable-next-line posthog-js/no-add-event-listener -- isolated benchmark page, not SDK runtime
                                            document.getElementById('activity').addEventListener('click', onInput)
                                        }
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
                                        setTimeout(async () => {
                                            try {
                                                const start = performance.now()
                                                actionStart = start
                                                const epochStart = performance.timeOrigin + start
                                                const input = mutationWorkloads
                                                    ? window.requestBenchmarkInput()
                                                    : Promise.resolve()
                                                const operation = phase.replace(/^off-/, '')
                                                let actionMs = 0
                                                for (
                                                    let step = 0;
                                                    step < (operation === 'churn' ? churnSteps : 1);
                                                    step++
                                                ) {
                                                    const actionStart = performance.now()
                                                    switch (operation) {
                                                        case 'rebuild':
                                                        case 'churn':
                                                            window.buildFixture()
                                                            break
                                                        case 'nested':
                                                            window.buildFixture(true)
                                                            break
                                                        case 'start':
                                                            window.posthog.startSessionRecording()
                                                            document.getElementById('activity').click()
                                                            break
                                                        case 'snapshot':
                                                            record.takeFullSnapshot()
                                                            break
                                                        case 'reorder': {
                                                            const fixture = window.benchmarkFixture
                                                            for (const parent of [
                                                                fixture,
                                                                fixture.querySelector('#benchmark-shadow')?.shadowRoot,
                                                            ]) {
                                                                if (parent)
                                                                    [...parent.querySelectorAll('[data-row]')]
                                                                        .reverse()
                                                                        .forEach((row) => row.parentNode.append(row))
                                                            }
                                                            window.fixtureReversed = !window.fixtureReversed
                                                            break
                                                        }
                                                        case 'mixed-move': {
                                                            const root = window.benchmarkFixture
                                                            const row = root.querySelector('[data-row]')
                                                            window.maskedRowId = row.getAttribute('data-row')
                                                            for (let round = 0; round <= moveRounds; round++) {
                                                                document.getElementById('destination').append(root)
                                                                row.classList.toggle('ph-mask', round % 2 === 0)
                                                                row.setAttribute('data-mixed', `round-${round}`)
                                                                const transient = document.createElement('span')
                                                                transient.textContent = 'BENCH_TRANSIENT_PRIVATE'
                                                                row.append(transient)
                                                                transient.remove()
                                                                if (round < moveRounds)
                                                                    document.body.insertBefore(
                                                                        root,
                                                                        document.getElementById('destination')
                                                                    )
                                                            }
                                                            row.classList.add('ph-mask')
                                                            window.mixedAttribute = `round-${moveRounds}`
                                                            break
                                                        }
                                                        case 'repeat-move':
                                                            for (let round = 0; round < moveRounds; round++) {
                                                                document
                                                                    .getElementById('destination')
                                                                    .append(window.benchmarkFixture)
                                                                document.body.insertBefore(
                                                                    window.benchmarkFixture,
                                                                    document.getElementById('destination')
                                                                )
                                                            }
                                                            document
                                                                .getElementById('destination')
                                                                .append(window.benchmarkFixture)
                                                            break
                                                        case 'subtree-remove':
                                                            window.benchmarkFixture.remove()
                                                            break
                                                        case 'restore':
                                                            document.body.insertBefore(
                                                                window.benchmarkFixture,
                                                                document.getElementById('destination')
                                                            )
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
                                                    actionMs += performance.now() - actionStart
                                                    // Mutation observers run before each checkpoint and before the next burst.
                                                    await new Promise((r) => setTimeout(r, 0))
                                                    if (operation === 'churn') {
                                                        checkpoint(`${phase}-${step}`)
                                                        await new Promise((r) => setTimeout(r, 16))
                                                    }
                                                }
                                                await input
                                                const workloadMs = performance.now() - start
                                                // Observer delivery happens before this timer. The marker passes through
                                                // the real SDK compression queue, buffer, request encoder and transport.
                                                await new Promise((r) => setTimeout(r, 0))
                                                checkpoint(phase)
                                                window.finishMeasurement = () => {
                                                    observer.disconnect()
                                                    cancelAnimationFrame(raf)
                                                    document
                                                        .getElementById('activity')
                                                        .removeEventListener('click', onInput)
                                                    return {
                                                        definitions,
                                                        inputDelays,
                                                        mirrorStats: window.mirrorStats || null,
                                                        layoutStats: window.layoutStats || null,
                                                        preprocessingStats:
                                                            window.__rrwebMutationProbe?.snapshot() || null,
                                                        maxFrameGapMs,
                                                        longTasks: longTasks.filter((t) => t.start >= start - 1),
                                                        debug: window.posthog.sessionRecording.sdkDebugProperties,
                                                    }
                                                }
                                                clearTimeout(deadline)
                                                resolve({ epochStart, actionMs, workloadMs })
                                            } catch (error) {
                                                clearTimeout(deadline)
                                                reject(error)
                                            }
                                        }, 50)
                                    }),
                                { phase, markerTag, mutationWorkloads, churnSteps, moveRounds, off }
                            )
                            if (!off) {
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
                            if (mutationWorkloads)
                                assert.equal(
                                    observation.inputDelays.length,
                                    1,
                                    `${phase}: trusted input was not handled`
                                )
                            const after = await client.send('Performance.getMetrics')
                            clearInterval(heapTimer)
                            await heapPending
                            if (heapError) throw heapError
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
                                wireMs: off ? null : receivedMarkers.get(phase) - timing.epochStart,
                                totalBlockingMs: observation.longTasks.reduce(
                                    (sum, task) => sum + Math.max(0, task.duration - 50),
                                    0
                                ),
                                inputDelayMs: observation.inputDelays[0] ?? null,
                                mirrorStats: observation.mirrorStats,
                                preprocessingStats: observation.preprocessingStats,
                                layoutStats: observation.layoutStats,
                                layoutCpuMs:
                                    1000 * (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')),
                                styleCpuMs:
                                    1000 *
                                    (metric(after, 'RecalcStyleDuration') - metric(before, 'RecalcStyleDuration')),
                                maxTaskMs: Math.max(0, ...observation.longTasks.map((t) => t.duration)),
                                longTaskCount: observation.longTasks.length,
                                maxFrameGapMs: observation.maxFrameGapMs,
                                taskCpuMs: 1000 * (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')),
                                heapDeltaBytes: metric(after, 'JSHeapUsedSize') - metric(before, 'JSHeapUsedSize'),
                                sampledMaxJSHeapUsedBytes: heapSamples.length ? Math.max(...heapSamples) : null,
                                heapSampleCount: heapSamples.length,
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
                            await writeFile(
                                path.join(output, `${label}.json`),
                                JSON.stringify(
                                    {
                                        label,
                                        shape,
                                        targetNodes,
                                        run,
                                        compress,
                                        metrics,
                                        validation: 'pending',
                                    },
                                    null,
                                    2
                                )
                            )
                            if (mutationWorkloads) {
                                assert.equal(
                                    metrics.at(-1).oversizedMutationsDropped,
                                    0,
                                    `${label}/${phase}: oversized mutation drops invalidate timing`
                                )
                                assert.equal(
                                    metrics.at(-1).throttledAttributesDropped,
                                    0,
                                    `${label}/${phase}: attribute drops invalidate timing`
                                )
                                assert.equal(
                                    metrics.at(-1).unexpectedFullSnapshots,
                                    0,
                                    `${label}/${phase}: recovery snapshots invalidate timing`
                                )
                            }
                            if (!off)
                                for (const definition of observation.definitions) {
                                    const end =
                                        wireEvents.findIndex(
                                            (event) =>
                                                event.type === 5 &&
                                                event.data.tag === markerTag &&
                                                event.data.payload === definition.phase
                                        ) + 1
                                    assert(end > 0, `${label}/${definition.phase}: missing checkpoint marker`)
                                    checkpoints.push({ ...definition, end })
                                }
                        }
                        // Preserve diagnostics even if a correctness checkpoint fails.
                        const result = { label, shape, targetNodes, run, compress, metrics, validation: 'pending' }
                        await writeFile(path.join(output, `${label}.json`), JSON.stringify(result, null, 2))
                        // Correctness validation is deliberately outside all measurement windows.
                        await page.evaluate(() => window.posthog.stopSessionRecording())
                        for (const {
                            phase,
                            end,
                            generation,
                            parent,
                            empty,
                            present,
                            reversed,
                            maskedRowId,
                            mixedAttribute,
                        } of checkpoints) {
                            // Every churn generation and trusted input gets a replay checkpoint, not just the final DOM.
                            // A fresh context prevents destroyed replay DOMs accumulating across large prefixes.
                            const validationContext = await browser.newContext()
                            try {
                                await validationContext.route('**/*', (route) => route.abort())
                                const validationPage = await validationContext.newPage()
                                await validationPage.addScriptTag({ content: replayer })
                                // Playwright's tagged object serialization can exceed CDP's 100 MB message cap.
                                // Upload bounded JSON strings instead; decoding remains outside timing windows.
                                const eventJson = JSON.stringify(wireEvents.slice(0, end))
                                await validationPage.evaluate(() => {
                                    window.replayInput = ''
                                })
                                for (let offset = 0; offset < eventJson.length; offset += 1024 * 1024) {
                                    await validationPage.evaluate(
                                        (chunk) => {
                                            window.replayInput += chunk
                                        },
                                        eventJson.slice(offset, offset + 1024 * 1024)
                                    )
                                }
                                const replayed = await validationPage.evaluate(
                                    ({ generation, shape, reversed, maskedRowId, mixedAttribute, depth }) => {
                                        const events = JSON.parse(window.replayInput)
                                        delete window.replayInput
                                        const player = new window.rrweb.Replayer(events, { UNSAFE_replayCanvas: false })
                                        player.pause(events.at(-1).timestamp - events[0].timestamp + 1)
                                        const doc = player.iframe.contentDocument
                                        const fixture = doc.querySelector('#fixture')
                                        const rows = [
                                            ...doc.querySelectorAll('#fixture [data-row]'),
                                            ...(fixture
                                                ?.querySelector('#benchmark-shadow')
                                                ?.shadowRoot?.querySelectorAll('[data-row]') || []),
                                        ]
                                        const cssRules = doc.getElementById('benchmark-css')?.sheet.cssRules
                                        const result = {
                                            fixtureCount: doc.querySelectorAll('#fixture').length,
                                            parent: fixture?.parentElement.id ?? null,
                                            rows: rows.length,
                                            orderedContent: rows.every((row, i) => {
                                                const lightCount =
                                                    shape === 'shadow' ? Math.floor(rows.length / 2) : rows.length
                                                const expectedIndex = !reversed
                                                    ? i
                                                    : i < lightCount
                                                      ? lightCount - 1 - i
                                                      : rows.length - 1 - (i - lightCount)
                                                return (
                                                    row.getAttribute('data-row') === String(expectedIndex) &&
                                                    row.textContent ===
                                                        (() => {
                                                            const text =
                                                                shape === 'flat'
                                                                    ? String(generation)
                                                                    : `${generation}label`.repeat(4)
                                                            return row.getAttribute('data-row') === maskedRowId
                                                                ? text.replace(/\S/g, '*')
                                                                : text
                                                        })() &&
                                                    (row.getAttribute('data-row') !== maskedRowId ||
                                                        (row.classList.contains('ph-mask') &&
                                                            row.getAttribute('data-mixed') === mixedAttribute)) &&
                                                    row.querySelectorAll('.cell[data-label="metric"]').length ===
                                                        (shape === 'flat' ? 0 : 4)
                                                )
                                            }),
                                            depthPreserved:
                                                shape !== 'deep' ||
                                                rows.length === 0 ||
                                                (fixture.querySelectorAll('[data-benchmark-depth]').length === depth &&
                                                    rows.every((row) => row.parentElement.id === 'deep-rows')),
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
                                    { generation, shape, reversed, maskedRowId, mixedAttribute, depth }
                                )
                                assert.deepEqual(
                                    replayed,
                                    {
                                        fixtureCount: present ? 1 : 0,
                                        parent,
                                        rows: empty ? 0 : Math.ceil(targetNodes / (shape === 'flat' ? 2 : 21)),
                                        orderedContent: true,
                                        depthPreserved: true,
                                        stylesheet: true,
                                        adoptedStyle: true,
                                    },
                                    `${label}/${phase}: replay did not reconstruct the fixture`
                                )
                            } finally {
                                if (browser.isConnected()) await validationContext.close()
                            }
                        }
                        result.validation = 'passed'
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
                        heapTimers.forEach(clearInterval)
                        if (browser.isConnected()) await context.close()
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
                mirrorCounters,
                layoutCounters,
                benchmarkSha256: createHash('sha256')
                    .update(await readFile(fileURLToPath(import.meta.url)))
                    .digest('hex'),
                mutationWorkloads,
                orderingWorkloads,
                preprocessingWorkloads,
                preprocessingProbe,
                depth,
                moveRounds,
                churnSteps,
                compression,
                results,
            },
            null,
            2
        )
    )
    await browser.close()
}
