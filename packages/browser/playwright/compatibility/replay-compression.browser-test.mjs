import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { compatibilityServer, observations } from './server.mjs'
import { createCompatibilityContext } from './network.mjs'
import { exerciseReplayLifecycle } from './replay-cases.mjs'
import { trackReplayCompression } from './replay-compression.mjs'
import { normalize } from './normalize.mjs'

const { expect, ...playwright } = createRequire(import.meta.url)('@playwright/test')
const manifest = JSON.parse(readFileSync(process.env.COMPATIBILITY_COMPRESSION_MANIFEST))
const directory = fileURLToPath(new URL('.', import.meta.url))

async function record(browser, engine, comparison, holdCompression) {
    const core = manifest.sources[comparison === 'historical' ? 'historical' : 'candidate']
    const extensions = manifest.sources.candidate
    const server = compatibilityServer({
        mode: 'snippet',
        scenario: 'replay-minimum-duration',
        coreDist: core.dist,
        coreVersion: core.version,
        extensionDist: extensions.dist,
        allowedAssets: [...new Set([...Object.keys(core.files), ...Object.keys(extensions.files)])],
        harness: join(directory, 'harness.js'),
        snippet: manifest.snippet.path,
        player: manifest.player.path,
    })
    const origin = await server.start()
    const context = await createCompatibilityContext(browser, engine, origin, {
        viewport: { width: 1024, height: 768 },
        locale: 'en-US',
        timezoneId: 'UTC',
        serviceWorkers: 'block',
        colorScheme: 'light',
        reducedMotion: 'reduce',
    })
    let release
    const gate = new Promise((resolve) => (release = resolve))
    let heldAt
    let lifecycle
    try {
        const page = await context.newPage()
        await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') })
        await page.clock.pauseAt(new Date('2024-01-01T00:00:01Z'))
        await page.addInitScript(trackReplayCompression)
        await page.exposeFunction('__compatHoldCompression', async (time) => {
            heldAt = time
            await gate
        })
        if (holdCompression)
            await page.addInitScript(() => {
                const NativeCompressionStream = window.CompressionStream
                let held = false
                window.CompressionStream = class extends NativeCompressionStream {
                    constructor(format) {
                        super(format)
                        if (held || document.querySelector('#change')?.textContent !== 'Qualified visit') return
                        held = true
                        // Hold real gzip bytes for the qualifying mutation, not SDK methods or fake output.
                        const readable = this.readable.pipeThrough(
                            new TransformStream({
                                async transform(chunk, controller) {
                                    await window.__compatHoldCompression(Date.now())
                                    controller.enqueue(chunk)
                                },
                            })
                        )
                        Object.defineProperty(this, 'readable', { value: readable })
                    }
                }
            })
        await page.goto(origin, { waitUntil: 'domcontentloaded' })
        await page.evaluate((comparison) => {
            window.__compat.mode = 'snippet'
            window.__compat.comparison = comparison
            window.__compat.initialize('replay-minimum-duration')
        }, comparison)
        server.releaseBarrier('core')
        await expect.poll(() => page.evaluate(() => window.__compat.loaded)).toBe(true)
        server.releaseBarrier('config')
        server.releaseBarrier('flags')
        await expect.poll(() => page.evaluate(() => !!window._POSTHOG_REMOTE_CONFIG?.phc_COMPAT?.config)).toBe(true)
        await page.evaluate(() => window.__compat.call('reloadFeatureFlags'))
        await page.clock.runFor(100)
        await expect
            .poll(() =>
                page.evaluate(() =>
                    window.__compat.ph.getFeatureFlag('compat-variant', { fresh: true, send_event: false })
                )
            )
            .toBe('blue')
        server.releaseBarrier('extensions')
        server.releaseBarrier('surveys')
        await expect.poll(() => page.evaluate(() => window.__compat.ph.sessionRecordingStarted())).toBe(true)
        await page.evaluate(() => window.__compat.readyProbe())
        lifecycle = exerciseReplayLifecycle({
            scenario: 'replay-minimum-duration',
            page,
            received: async () => observations(server),
            expect,
            origin,
        })
        // Keep an early lifecycle rejection handled while the controller waits for the native gate.
        lifecycle.catch(() => {})
        if (holdCompression) {
            await expect.poll(() => heldAt).toBeDefined()
            await expect.poll(() => page.evaluate(() => window.__compatPendingBlobReads())).toBeGreaterThan(0)
            assert.equal(await page.evaluate(() => Date.now()), heldAt, 'Clock advanced while compression was held')
            release()
        }
        const { replay } = await lifecycle
        const network = observations(server)
        assert(
            network.snapshots.some((snapshot) =>
                snapshot.properties.$snapshot_data.some((event) => event.cv === '2024-10')
            ),
            'Recorder did not use event compression'
        )
        return normalize({ network, replay }, { origin, version: core.version, extensionVersion: extensions.version })
    } finally {
        release()
        await lifecycle?.catch(() => {})
        await context.close()
        await server.stop()
    }
}

for (const engine of ['chromium', 'firefox', 'webkit']) {
    for (const comparison of ['current', 'historical']) {
        test(
            `replay minimum-duration snapshots survive delayed native gzip in ${engine}/${comparison}`,
            { timeout: 60000 },
            async () => {
                const browser = await playwright[engine].launch()
                try {
                    const normal = await record(browser, engine, comparison, false)
                    const delayed = await record(browser, engine, comparison, true)
                    assert.deepEqual(delayed, normal)
                } finally {
                    await browser.close()
                }
            }
        )
    }
}
