/* eslint-disable posthog-js/no-direct-function-check, no-console -- Standalone browser test fixtures exercise public APIs without importing SDK runtime helpers. */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { normalize, differences, decodeReplay } from './normalize.mjs'
import { parseOptions, selection } from './options.mjs'
import { assertLoaderProof } from './loader-proof.mjs'
import { interactionScenarios, exerciseInteractions } from './interaction-cases.mjs'
import { compatibilityServer } from './server.mjs'
import { createCompatibilityContext } from './network.mjs'
import { directory as lab, repository, verifyInputs, digest } from './prepare.mjs'
import { MATRIX, buildGoldens, compareGoldens, updateGoldens } from './golden.mjs'

const args = parseOptions(process.argv.slice(2), [
    'manifest',
    'engines',
    'modes',
    'comparisons',
    'scenarios',
    'repeats',
    'output',
    'operation',
    'goldens',
])
const manifest = JSON.parse(readFileSync(args.manifest))
const require = createRequire(join(repository, 'packages/browser/package.json'))
const playwright = require('@playwright/test')
const { expect } = playwright
const selectedEngines = selection(MATRIX.browsers, args.engines, 'engines')
const selectedModes = selection(MATRIX.entrypoints, args.modes, 'modes')
const selectedComparisons = selection(['current', 'historical'], args.comparisons, 'comparisons')
const selectedScenarios = selection(MATRIX.scenarios, args.scenarios, 'scenarios')
const repeats = Number(args.repeats ?? 2)
if (!Number.isInteger(repeats) || repeats < 2) throw new Error('At least two repetitions are required')
const operation = args.operation ?? 'check'
if (!['check', 'update', 'validate'].includes(operation)) throw new Error('Invalid operation')
const output = resolve(args.output)
mkdirSync(output, { recursive: false })
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const assert = (condition, message) => {
    if (!condition) throw new Error(message)
}
const manifestDigest = digest(args.manifest)
const before = verifyInputs(manifest)
before.runtime['prepared-manifest'] = manifestDigest
const expectedIntegrity = {
    ...manifest.inputIntegrity,
    runtime: { ...manifest.inputIntegrity.runtime, 'prepared-manifest': manifestDigest },
}
write(join(output, 'manifest.json'), {
    ...manifest,
    selectedEngines,
    selectedModes,
    selectedComparisons,
    selectedScenarios,
    repeats,
})

async function serverFor(settings, folder) {
    write(join(folder, 'settings.json'), settings)
    const server = compatibilityServer(settings)
    const origin = await server.start()
    return { ...server, origin }
}

async function runCell(browser, { engine, mode, comparison, scenario, repeat }) {
    const label = `${engine}-${mode}-${comparison}-${scenario}-${repeat}`
    const folder = join(output, label)
    mkdirSync(folder, { recursive: true })
    const core = manifest.sources[comparison === 'historical' ? 'historical' : 'candidate']
    const extensions = manifest.sources.candidate
    const settings = {
        mode,
        scenario,
        coreDist: core.dist,
        coreVersion: core.version,
        extensionDist: extensions.dist,
        fixture: core.fixtures[mode]?.path,
        allowedAssets: [...new Set([...Object.keys(core.files), ...Object.keys(extensions.files)])],
        harness: join(lab, 'harness.js'),
        snippet: manifest.snippet.path,
        player: manifest.player.path,
    }
    const server = await serverFor(settings, folder)
    const userAgent =
        playwright.devices[{ chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' }[engine]]
            .userAgent
    const context = await createCompatibilityContext(browser, engine, server.origin, {
        userAgent,
        viewport: { width: 1024, height: 768 },
        locale: 'en-US',
        timezoneId: 'UTC',
        serviceWorkers: 'block',
        colorScheme: 'light',
        reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const pageErrors = []
    const unexpectedNetwork = []
    const consoleErrors = []
    page.on('pageerror', (error) => pageErrors.push({ name: error.name, message: error.message }))
    const historicalSlim = comparison === 'historical' && mode === 'slim'
    const knownSlimError = (error) =>
        error.name === 'TypeError' && error.message.startsWith('this.instance._shouldDisableFlags is not a function')
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
    })
    context.on('request', (request) => {
        const url = new URL(request.url())
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== server.origin)
            unexpectedNetwork.push(request.url())
    })
    const interactionCase = interactionScenarios.includes(scenario)
    if (interactionCase) {
        await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') })
        await page.clock.pauseAt(new Date('2024-01-01T00:00:01Z'))
    } else await page.clock.setFixedTime(new Date('2024-01-01T00:00:00Z'))
    const waitFor = (fn, argument) =>
        interactionCase
            ? expect.poll(() => page.evaluate(fn, argument)).toBeTruthy()
            : page.waitForFunction(fn, argument)
    const remote = async (path, body) => {
        const response = await fetch(
            server.origin + path,
            body
                ? {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(body),
                      signal: AbortSignal.timeout(15000),
                  }
                : { signal: AbortSignal.timeout(15000) }
        )
        if (!response.ok) throw new Error(`Mock control failed: ${path}: ${response.status}`)
        return response.json()
    }
    const release = (...barriers) => remote('/__compat/release', { barriers })
    const received = () => remote('/__compat/received')
    let api,
        ui = {},
        replay = {}
    const loading = {}
    try {
        await page.goto(server.origin, { waitUntil: 'domcontentloaded' })
        if (mode !== 'snippet') await waitFor(() => window.__compat?.installed)
        await page.evaluate(
            ({ scenario, mode }) => {
                window.__compat.mode = mode
                window.__compat.initialize(scenario)
            },
            { scenario, mode }
        )
        await release('core')
        await waitFor(() => window.__compat?.loaded)
        assert(
            (await page.evaluate(() => window.__compat.ph.version)) === core.version,
            'Loaded core version does not match the prepared manifest'
        )
        await page.evaluate(() => window.__compat.probe('pending'))
        assert(!(await remote('/__compat/barriers')).config, 'Config gate released too early')
        assert(!(await remote('/__compat/barriers')).flags, 'Flags gate released too early')
        await release('config', 'flags')
        if (historicalSlim) {
            await expect.poll(() => pageErrors.some(knownSlimError), { timeout: 15000 }).toBe(true)
            assert(pageErrors.every(knownSlimError), `Unexpected historical slim errors: ${JSON.stringify(pageErrors)}`)
            await expect
                .poll(async () => (await received()).events.filter((event) => event.event === 'compat-pending').length)
                .toBe(1)
            assert(unexpectedNetwork.length === 0, `Unexpected network: ${unexpectedNetwork}`)
            api = await page.evaluate(() => window.__compat.finish())
            const network = await received()
            assert(api.unhandled.length === 0, `Unhandled rejections: ${JSON.stringify(api.unhandled)}`)
            assert(network.errors.length === 0, `Mock errors: ${JSON.stringify(network.errors)}`)
            const raw = {
                wire: server.inspect(),
                userAgent,
                api,
                network,
                ui,
                replay,
                pageErrors,
                unexpectedNetwork,
                consoleErrors,
            }
            write(join(folder, 'raw.json'), raw)
            const normalized = normalize(
                {
                    api,
                    network,
                    ui,
                    replay,
                    pageErrors: pageErrors.map((error) => ({
                        name: error.name,
                        message: 'this.instance._shouldDisableFlags is not a function',
                    })),
                    unexpectedNetwork,
                    terminalOutcome: 'known-historical-slim-initialization-failure',
                },
                { origin: server.origin, version: core.version, extensionVersion: extensions.version }
            )
            write(join(folder, 'snapshot.json'), normalized)
            return {
                status: 'passed',
                assertionsPassed: true,
                runtimeErrors: [],
                functionalCoverage: 'initialization-failure-only',
                terminalOutcome: 'known-historical-slim-initialization-failure',
                initializationError: pageErrors[0],
                label,
                folder,
                observations: normalized,
            }
        }
        if (interactionCase) {
            await expect
                .poll(async () =>
                    (await received()).requests.some((request) => /\/config(?:\.js)?$/.test(request.path))
                )
                .toBe(true)
            await waitFor(() => !!window._POSTHOG_REMOTE_CONFIG?.phc_COMPAT?.config)
            await page.evaluate(() => window.__compat.call('reloadFeatureFlags'))
            await page.clock.runFor(100)
        }
        await waitFor(
            () => window.__compat.ph.getFeatureFlag('compat-variant', { fresh: true, send_event: false }) === 'blue'
        )
        if (scenario === 'delayed-loading') {
            await expect
                .poll(async () =>
                    (await received()).blockedRequests.some(
                        (request) => request.barrier === 'extensions' && /\/surveys(?:-[^.]+)?\.js$/.test(request.path)
                    )
                )
                .toBe(true)
            loading.pendingRequest = true
            loading.renderedBeforeRelease = (await page.locator('.PostHogSurvey-compat-survey').count()) > 0
            assert(!loading.renderedBeforeRelease, 'Survey rendered while its extension response was held')
            await page.evaluate(() => {
                window.__compat.probe('extensions-pending')
                window.__compat.call('capture', ['compat-during-extension-delay'])
            })
        }
        await release('extensions', 'surveys')
        if (scenario === 'logs' && (await page.evaluate(() => typeof window.__compat.ph.captureLog === 'function'))) {
            await page.waitForFunction(() => typeof window.__PosthogExtensions__?.logs?.initializeLogs === 'function')
        }
        if (['surveys', 'delayed-loading', 'version-fallback'].includes(scenario)) {
            await page.waitForFunction(() => window.__compat.surveyNotifications >= 3)
            await expect
                .poll(async () =>
                    page.evaluate(() =>
                        window.__compat.ph.canRenderSurveyAsync('compat-survey').then((result) => result.visible)
                    )
                )
                .toBe(true)
        }
        if (scenario === 'replay') await page.waitForFunction(() => window.__compat.ph.sessionRecordingStarted())
        if (scenario === 'extension-failure') {
            await expect
                .poll(async () =>
                    (await received()).requests.some(
                        (request) => request.path.endsWith('/surveys.js') && request.status === 503
                    )
                )
                .toBe(true)
            await page.waitForFunction(() => window.__compat.surveyNotifications >= 3)
        }
        await page.evaluate(() => window.__compat.readyProbe())
        if (scenario === 'core') {
            let notifications = await page.evaluate(() => window.__compat.flagNotifications)
            await page.evaluate(() => window.__compat.identity())
            await page.waitForFunction((count) => window.__compat.flagNotifications > count, notifications)
            notifications = await page.evaluate(() => window.__compat.flagNotifications)
            await page.evaluate(() => window.__compat.reset())
            await expect
                .poll(async () => (await received()).events.filter((e) => e.event === 'compat-reset').length)
                .toBe(1)
            await page.waitForFunction((count) => window.__compat.flagNotifications > count, notifications)
            await page.evaluate(() => window.__compat.consent())
        }
        if (scenario === 'cleanup') {
            await page.evaluate(() => window.__compat.cleanup())
            await page.waitForFunction(() => window.__compat.cleanupObserverCalls >= 2)
            assert(
                await page.evaluate(() => window.__compat.staleFlagCallbacks === 0),
                'Unsubscribed flags callback fired again'
            )
            assert(
                await page.evaluate(
                    () =>
                        window.__compat.callbacks.filter(
                            (callback) => callback.callback === 'feature-flags' && callback.originPhase === 'pending'
                        ).length > window.__compat.cleanupPendingCount
                ),
                'Unsubscribing one flags callback removed another listener'
            )
            await page.evaluate(() => window.__compat.call('capture', ['compat-after-cleanup']))
        }
        if (['delayed-loading', 'version-fallback'].includes(scenario)) {
            const notifications = await page.evaluate(() => window.__compat.flagNotifications)
            await page.evaluate(() => {
                window.__compat.phase = 'loader-shown'
                window.__compat.call('displaySurvey', ['compat-survey'])
            })
            const survey = page.locator('.PostHogSurvey-compat-survey')
            await expect(survey.locator('.survey-question')).toHaveText('How was your experience?')
            await page.waitForFunction((count) => window.__compat.flagNotifications > count, notifications)
            ui.loaded = await survey.innerText()
            loading.renderedAfterRelease = true
        }
        if (scenario === 'autocapture') {
            await page.locator('#action').click({ force: true })
            await expect
                .poll(async () => (await received()).events.filter((e) => e.event === '$autocapture').length)
                .toBe(1)
        }
        if (scenario === 'surveys') {
            let notifications = await page.evaluate(() => window.__compat.flagNotifications)
            await page.evaluate(() => {
                window.__compat.phase = 'survey-shown'
                window.__compat.call('displaySurvey', ['compat-survey'])
            })
            const survey = page.locator('.PostHogSurvey-compat-survey')
            await expect(survey.locator('.survey-question')).toHaveText('How was your experience?')
            ui.before = await survey.innerText()
            await page.waitForFunction((count) => window.__compat.flagNotifications > count, notifications)
            notifications = await page.evaluate(() => window.__compat.flagNotifications)
            await page.evaluate(() => {
                window.__compat.phase = 'survey-submitted'
            })
            await survey.locator('textarea').fill('Compatibility feedback')
            await survey.locator('.form-submit').click({ force: true })
            await expect
                .poll(async () => (await received()).events.filter((e) => e.event === 'survey sent').length)
                .toBe(1)
            await page.waitForFunction((count) => window.__compat.flagNotifications > count, notifications)
            ui.after = await survey.innerText()
        }
        if (scenario === 'logs' && (await page.evaluate(() => typeof window.__compat.ph.captureLog === 'function'))) {
            await page.evaluate(() => {
                window.__compat.phase = 'log'
                window.__compat.call('captureLog', [
                    { body: 'compat-programmatic', level: 'warn', attributes: { retained: true } },
                ])
                console.info('compat-console')
                window.__compat.call('logs.flushLogs')
            })
            await expect
                .poll(async () => JSON.stringify((await received()).logs).includes('compat-programmatic'))
                .toBe(true)
            await expect.poll(async () => JSON.stringify((await received()).logs).includes('compat-console')).toBe(true)
        }
        if (scenario === 'replay') {
            await page.evaluate(() => {
                document.querySelector('#change').textContent = 'Updated'
                document.querySelector('#masked').value = 'changed-secret-password'
                window.__compat.phase = 'recording'
                window.__compat.call('capture', ['compat-replay-marker'])
            })
            await page.evaluate(
                () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            )
            await page.evaluate(() => window.__compat.call('stopSessionRecording'))
            await expect.poll(async () => (await received()).snapshots.length, { timeout: 15000 }).toBeGreaterThan(0)
            const snapshots = decodeReplay((await received()).snapshots)
            const events = snapshots.flatMap((event) => event.properties?.$snapshot_data ?? [])
            assert(
                events.some((event) => event.type === 2),
                'No replay full snapshot delivered'
            )
            assert(
                events.some((event) => event.type === 3),
                'No replay DOM mutation delivered'
            )
            const serialized = JSON.stringify(events)
            for (const secret of ['secret-password', 'changed-secret-password', 'private-compat-text'])
                assert(!serialized.includes(secret), `Replay leaked ${secret}`)
            const player = await context.newPage()
            await player.goto(server.origin + '/player')
            await player.evaluate((events) => {
                const root = document.createElement('div')
                document.body.appendChild(root)
                window.__player = new window.__CompatReplayer(events, { root, showWarning: false, showDebug: false })
                window.__player.pause(1000)
            }, events)
            await expect
                .poll(async () =>
                    player.evaluate(
                        () =>
                            !!document
                                .querySelector('.replayer-wrapper iframe')
                                ?.contentDocument?.querySelector('#change')
                    )
                )
                .toBe(true)
            replay = await player.evaluate(() => ({
                fullSnapshotRebuilt: !!document
                    .querySelector('.replayer-wrapper iframe')
                    ?.contentDocument?.querySelector('#change'),
                input: document.querySelector('.replayer-wrapper iframe')?.contentDocument?.querySelector('#masked')
                    ?.value,
                text: document.querySelector('.replayer-wrapper iframe')?.contentDocument?.querySelector('#change')
                    ?.textContent,
            }))
            await player.close()
        }
        if (interactionCase)
            ui = await exerciseInteractions({ scenario, page, received, expect, origin: server.origin })
        await waitFor(() => window.__compat.promises.every((promise) => promise.state !== 'pending'))
        if (scenario === 'unload') {
            await page.evaluate(() => {
                window.__compat.phase = 'unload'
                window.__compat.call('capture', ['compat-unload-marker'])
            })
            api = await page.evaluate(() => window.__compat.finish())
            await page.goto(server.origin + '/after')
        } else api = await page.evaluate(() => window.__compat.finish())
        await expect
            .poll(
                async () =>
                    (await received()).events.filter(
                        (e) =>
                            e.event ===
                            (scenario === 'unload'
                                ? 'compat-unload-marker'
                                : scenario === 'core'
                                  ? 'compat-after-opt-in'
                                  : 'compat-ready')
                    ).length
            )
            .toBe(1)
        const network = await received()
        assert(!network.events.some((e) => e.event === 'compat-must-not-deliver'), 'Opted-out event reached the server')
        assert(unexpectedNetwork.length === 0, `Unexpected network: ${unexpectedNetwork}`)
        assert(pageErrors.length === 0, `Page errors: ${JSON.stringify(pageErrors)}`)
        assert(api.unhandled.length === 0, `Unhandled rejections: ${JSON.stringify(api.unhandled)}`)
        assert(network.errors.length === 0, `Mock errors: ${JSON.stringify(network.errors)}`)
        for (const phase of ['before-init', 'loaded', 'init-return', 'pending', 'ready'])
            assert(
                api.observations.some((o) => o.phase === phase),
                `Missing lifecycle phase: ${phase}`
            )
        for (const event of ['compat-loaded', 'compat-init-return', 'compat-pending', 'compat-ready'])
            assert(network.events.filter((e) => e.event === event).length === 1, `Missing or duplicate ${event}`)
        if (scenario === 'disabled')
            assert(
                !network.requests.some((r) => /\/(surveys|logs|.*recorder)\.js$/.test(r.path)),
                'Disabled product loaded an extension'
            )
        const unexpectedFailures = network.requests.filter(
            (r) =>
                r.status >= 400 &&
                !(scenario === 'extension-failure' && r.path.endsWith('/surveys.js')) &&
                !(scenario === 'version-fallback' && /^\/static\/[^/]+\/[^/]+\.js$/.test(r.path))
        )
        assert(unexpectedFailures.length === 0, `Unexpected failures: ${JSON.stringify(unexpectedFailures)}`)
        const loaderCoverage = assertLoaderProof(scenario, comparison, network.requests, loading)
        const raw = {
            wire: server.inspect(),
            userAgent,
            api,
            network,
            ui,
            replay,
            loading,
            loaderCoverage,
            pageErrors,
            unexpectedNetwork,
            consoleErrors,
        }
        write(join(folder, 'raw.json'), raw)
        const normalized = normalize(
            {
                api,
                network,
                ui,
                replay,
                loading,
                ...(loaderCoverage ? { loaderCoverage } : {}),
                pageErrors,
                unexpectedNetwork,
            },
            { origin: server.origin, version: core.version, extensionVersion: extensions.version }
        )
        write(join(folder, 'snapshot.json'), normalized)
        return {
            status: 'passed',
            assertionsPassed: true,
            runtimeErrors: [],
            functionalCoverage: 'fully-ready',
            terminalOutcome: 'fully-ready',
            loaderCoverage,
            label,
            folder,
            observations: normalized,
        }
    } catch (error) {
        let state
        try {
            state = {
                api: api ?? (await page.evaluate(() => window.__compat?.finish())),
                network: await received(),
                wire: server.inspect(),
                pageErrors,
                unexpectedNetwork,
                consoleErrors,
            }
        } catch {}
        write(join(folder, 'failure.json'), { message: error.message, stack: error.stack, state })
        await page.screenshot({ path: join(folder, 'failure.png') }).catch(() => {})
        return { status: 'failed', label, folder, error: error.message }
    } finally {
        try {
            await context.close()
        } finally {
            write(join(folder, 'server.json'), server.inspect())
            await server.stop()
        }
    }
}

const runs = [],
    results = [],
    cellFailures = [],
    browserVersions = {}
for (const engine of selectedEngines) {
    let browser
    try {
        browser = await playwright[engine].launch({ headless: true })
        browserVersions[engine] = browser.version()
    } catch (error) {
        cellFailures.push({ engine, error: error.message })
        continue
    }
    try {
        for (const mode of selectedModes)
            for (const comparison of selectedComparisons)
                for (const scenario of selectedScenarios) {
                    const cell = {
                        browser: engine,
                        entrypoint: mode,
                        coreFamily: comparison === 'historical' ? 'historical-1.354.0' : 'current',
                        scenario,
                    }
                    const result = { ...cell, status: 'passed', runs: [], differences: [] }
                    let expected
                    for (let repeat = 0; repeat < repeats; repeat++) {
                        const run = {
                            ...cell,
                            repeat,
                            ...(await runCell(browser, { engine, mode, comparison, scenario, repeat })),
                        }
                        runs.push(run)
                        result.runs.push({ ...run, observations: undefined })
                        if (run.status !== 'passed') result.status = 'failed'
                        else if (!expected) expected = run.observations
                        else {
                            const diff = differences(expected, run.observations)
                            if (diff.length) {
                                result.status = 'failed'
                                result.differences.push({ label: run.label, count: diff.length, differences: diff })
                            }
                        }
                    }
                    results.push(result)
                    write(join(output, 'progress.json'), results)
                    console.log(`${result.status.toUpperCase()} ${engine}/${mode}/${comparison}/${scenario}`)
                }
    } finally {
        await browser.close()
    }
}
let goldenResult, input, error
try {
    const after = verifyInputs(manifest)
    after.runtime['prepared-manifest'] = digest(args.manifest)
    input = {
        repeats,
        selection: {
            browsers: selectedEngines,
            entrypoints: selectedModes,
            coreFamilies: selectedComparisons.map((value) => (value === 'historical' ? 'historical-1.354.0' : value)),
            scenarios: selectedScenarios,
        },
        inputIntegrity: { expected: expectedIntegrity, before, after },
        runs,
    }
    if (cellFailures.length) throw new Error('Browser launch failures')
    const built = buildGoldens(input)
    if (operation === 'validate')
        goldenResult = {
            coverage: built.coverage,
            cellCount: built.cellCount,
            functionalCoverage: built.functionalCoverage,
            repeats: built.repeats,
            validated: true,
        }
    else if (operation === 'update') goldenResult = await updateGoldens(args.goldens ?? join(lab, 'goldens'), input)
    else goldenResult = await compareGoldens(args.goldens ?? join(lab, 'goldens'), input)
} catch (failure) {
    error = {
        message: failure.message,
        stack: failure.stack,
        ...(failure.differences ? { differences: failure.differences } : {}),
    }
}
const passed = !error && !cellFailures.length && (operation !== 'check' || goldenResult.matched)
const report = {
    schema: 1,
    operation,
    passed,
    browserVersions,
    platform: process.platform,
    nodeVersion: process.version,
    manifestDigest,
    completedCells: results.length,
    completedRuns: runs.length,
    repeats,
    functionalCoverage: runs.reduce((counts, run) => {
        if (run.status === 'passed') counts[run.functionalCoverage] = (counts[run.functionalCoverage] ?? 0) + 1
        return counts
    }, {}),
    cellFailures,
    goldenResult,
    error,
    results,
}
write(join(output, 'report.json'), report)
if (input) write(join(output, 'input-integrity.json'), input.inputIntegrity)
console.log(
    JSON.stringify(
        {
            output,
            passed,
            completedCells: results.length,
            completedRuns: runs.length,
            goldenResult: goldenResult ? { ...goldenResult, differences: undefined } : undefined,
            error: error?.message,
            cellFailures,
        },
        null,
        2
    )
)
process.exitCode = passed ? 0 : 1
