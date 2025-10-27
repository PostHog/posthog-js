import { expect, test } from './utils/posthog-playwright-test-base'
import { gotoPage } from './utils/setup'
import { PerformanceMetrics } from './utils/performance-utils'
import { pollUntilEventCaptured } from './utils/event-capture-utils'
import * as fs from 'fs'
import * as path from 'path'
import { BrowserContext, Page } from '@playwright/test'
import { Compression, FlagsResponse } from '@/types'

const BLOCKING_TIME_THRESHOLD_MS = 500
const SCRIPT_LOAD_SETTLE_TIME_MS = 100
const QUIET_WINDOW_MS = 500
const MAX_WAIT_MS = 5000
const LONG_TASK_THRESHOLD_MS = 50

function createMockFlagsResponse(includeSessionRecording: boolean): FlagsResponse {
    return {
        editorParams: {},
        flags: {},
        featureFlags: {},
        featureFlagPayloads: {},
        errorsWhileComputingFlags: false,
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
        supportedCompression: [Compression.GZipJS],
        autocaptureExceptions: false,
        capturePerformance: true,
        sessionRecording: includeSessionRecording
            ? {
                  endpoint: '/ses/',
              }
            : undefined,
    }
}

async function setupMockFlags(context: BrowserContext, includeSessionRecording: boolean): Promise<void> {
    const flagsResponse = createMockFlagsResponse(includeSessionRecording)
    void context.route('**/flags/*', (route) => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(flagsResponse),
        })
    })
}

async function measurePostHogBlockingTime(
    page: Page,
    context: BrowserContext,
    posthogOptions: Record<string, any> = {},
    includeSessionRecording: boolean = true
): Promise<PerformanceMetrics> {
    await setupMockFlags(context, includeSessionRecording)
    await gotoPage(page, '/playground/performance/index.html')

    const metrics = await page.evaluate(
        async ({ options, constants }) => {
            const longTasks: Array<{ startTime: number; duration: number; blockingTime: number }> = []
            let observerSupported = false

            if ('PerformanceObserver' in window) {
                try {
                    const observer = new PerformanceObserver((list) => {
                        observerSupported = true
                        for (const entry of list.getEntries()) {
                            longTasks.push({
                                startTime: entry.startTime,
                                duration: entry.duration,
                                blockingTime: Math.max(0, entry.duration - constants.longTaskThreshold),
                            })
                        }
                    })

                    observer.observe({ entryTypes: ['longtask'] })
                } catch {
                    // PerformanceObserver not supported
                }
            }

            const scriptLoadStartTime = performance.now()

            const script = document.createElement('script')
            script.src = '/dist/array.js'

            await new Promise<void>((resolve, reject) => {
                script.onload = () => {
                    performance.mark('posthog-script-loaded')
                    resolve()
                }
                script.onerror = () => reject(new Error('Failed to load PostHog script'))
                document.head.appendChild(script)
            })

            await new Promise((resolve) => setTimeout(resolve, constants.settleTime))

            performance.mark('posthog-init-start')

            if ((window as any).posthog) {
                ;(window as any).capturedEvents = []

                const opts = {
                    api_host: 'https://localhost:1234',
                    debug: true,
                    ip: false,
                    opt_out_useragent_filter: true,
                    before_send: (event: any) => {
                        const win = window as any
                        win.capturedEvents = win.capturedEvents || []

                        if (event) {
                            win.capturedEvents.push(event)
                        }

                        return event
                    },
                    loaded: () => {
                        performance.mark('posthog-loaded')
                        ;(window as any).__posthogLoaded = true
                    },
                    ...options,
                }
                ;(window as any).posthog.init('test-token', opts)

                await new Promise((resolve) => {
                    const checkLoaded = () => {
                        if ((window as any).__posthogLoaded) {
                            resolve(true)
                        } else {
                            setTimeout(checkLoaded, 10)
                        }
                    }
                    checkLoaded()
                })
            }

            const startWaitTime = performance.now()

            await new Promise<void>((resolve) => {
                const checkQuiet = () => {
                    const now = performance.now()

                    if (now - startWaitTime > constants.maxWait) {
                        resolve()
                        return
                    }

                    if (longTasks.length === 0) {
                        if (now - scriptLoadStartTime > constants.quietWindow) {
                            resolve()
                            return
                        }
                    } else {
                        const lastTask = longTasks[longTasks.length - 1]
                        const lastTaskEnd = lastTask.startTime + lastTask.duration
                        const timeSinceLastTask = now - lastTaskEnd

                        if (timeSinceLastTask >= constants.quietWindow) {
                            resolve()
                            return
                        }
                    }

                    setTimeout(checkQuiet, 50)
                }
                checkQuiet()
            })

            const measures = performance.getEntriesByType('mark')
            const scriptLoadMark = measures.find((m) => m.name === 'posthog-script-loaded')
            const initStartMark = measures.find((m) => m.name === 'posthog-init-start')
            const loadedMark = measures.find((m) => m.name === 'posthog-loaded')

            const scriptLoadTime = scriptLoadMark ? scriptLoadMark.startTime - scriptLoadStartTime : 0
            const initTime = loadedMark && initStartMark ? loadedMark.startTime - initStartMark.startTime : 0

            const totalBlockingTime = longTasks.reduce((sum, task) => sum + task.blockingTime, 0)
            const longestTaskDuration = longTasks.length > 0 ? Math.max(...longTasks.map((t) => t.duration)) : 0

            const totalTime = scriptLoadTime + initTime
            const estimatedBlockingTime = observerSupported
                ? totalBlockingTime
                : Math.max(0, totalTime - constants.longTaskThreshold)

            const lastTaskEndTime =
                longTasks.length > 0
                    ? longTasks[longTasks.length - 1].startTime + longTasks[longTasks.length - 1].duration
                    : scriptLoadStartTime + totalTime

            const result = {
                totalBlockingTime: Math.round(observerSupported ? totalBlockingTime : estimatedBlockingTime),
                longTaskCount: longTasks.length,
                longestTaskDuration: Math.round(longestTaskDuration > 0 ? longestTaskDuration : totalTime),
                timeToQuiet: Math.round(lastTaskEndTime - scriptLoadStartTime),
                tasks: longTasks,
                observerSupported,
                scriptLoadTime: Math.round(scriptLoadTime),
                initTime: Math.round(initTime),
            }

            ;(window as any).__performanceMetrics = result

            return result
        },
        {
            options: posthogOptions,
            constants: {
                longTaskThreshold: LONG_TASK_THRESHOLD_MS,
                settleTime: SCRIPT_LOAD_SETTLE_TIME_MS,
                quietWindow: QUIET_WINDOW_MS,
                maxWait: MAX_WAIT_MS,
            },
        }
    )

    return metrics
}

function writeMetrics(scenario: string, metrics: PerformanceMetrics): void {
    const outputDir = path.resolve(process.cwd(), 'performance-results')
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
    }

    fs.writeFileSync(
        path.join(outputDir, `performance-metrics-${scenario}.json`),
        JSON.stringify(
            {
                ...metrics,
                scenario,
                threshold: BLOCKING_TIME_THRESHOLD_MS,
                passed: metrics.totalBlockingTime <= BLOCKING_TIME_THRESHOLD_MS,
                timestamp: new Date().toISOString(),
            },
            null,
            2
        )
    )
}

test.describe('PostHog Performance - Main Thread Blocking', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'Performance tests only run on Chromium')

    test('measures blocking time with session recording', async ({ page, context }) => {
        const recorderPromise = page.waitForResponse((response) => response.url().includes('recorder'))

        const fullMetrics = await measurePostHogBlockingTime(page, context, {}, true)

        await page.locator('#test-button').click()
        await pollUntilEventCaptured(page, '$snapshot')

        // Get recorder download timing from browser performance API
        const recorderDownloadTime = await page.evaluate(() => {
            const recorderEntry = performance
                .getEntriesByType('resource')
                .find((entry) => entry.name.includes('recorder')) as PerformanceResourceTiming | undefined

            return recorderEntry ? Math.round(recorderEntry.duration) : undefined
        })

        await recorderPromise

        expect(fullMetrics.totalBlockingTime).toBeLessThanOrEqual(BLOCKING_TIME_THRESHOLD_MS)

        writeMetrics('full', { ...fullMetrics, recorderDownloadTime })
    })

    test('measures blocking time without replay', async ({ page, context }) => {
        const noReplayMetrics = await measurePostHogBlockingTime(
            page,
            context,
            {
                disable_session_recording: true,
            },
            false
        )

        // Verify events are being captured
        await pollUntilEventCaptured(page, '$pageview')
        await page.expectCapturedEventsToBe(['$pageview'])

        expect(noReplayMetrics.totalBlockingTime).toBeLessThanOrEqual(BLOCKING_TIME_THRESHOLD_MS)

        writeMetrics('no-replay', noReplayMetrics)
    })
})
