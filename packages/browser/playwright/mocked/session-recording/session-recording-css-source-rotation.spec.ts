import path from 'path'
import type { Replayer } from '@posthog/rrweb'
import type { eventWithTime } from '../../../src/extensions/replay/types/rrweb-types'
import { expect, test, type WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

type FixtureWindow = WindowWithPostHog & {
    posthog: NonNullable<WindowWithPostHog['posthog']>
    rotationEvents: eventWithTime[]
    rotationSheet: CSSStyleSheet
    mutateOnRotation: boolean
    mutatedOnRotation: boolean
    stopInSnapshot: boolean
    cancelledDuringStartup: boolean
    forwardedAfterCancel: boolean
    nativeStyleGetter: PropertyDescriptor['get']
    rrweb: { Replayer: typeof Replayer }
}

test.describe('CSS source across session rotation', () => {
    for (const mode of [
        'unchanged',
        'callback-mutation',
        'callback-stop',
        'callback-optout',
        'startup-stop',
        'startup-optout',
    ] as const) {
        test(mode, async ({ page, context }) => {
            await start(
                {
                    options: { session_recording: { compress_events: false } },
                    runBeforePostHogInit: async (page) => {
                        // Exercise today's CDN recorder even when the compatibility job supplies an older full core.
                        await page.addScriptTag({ url: 'https://localhost:1234/static/lazy-recorder.js' })
                        await page.evaluate(() => {
                            const win = window as FixtureWindow
                            win.forwardedAfterCancel = false
                            const initialize = win.__PosthogExtensions__!.initSessionRecording!
                            win.__PosthogExtensions__!.initSessionRecording = (...args) => {
                                const recorder = initialize(...args)
                                const emit = recorder.onRRwebEmit.bind(recorder)
                                recorder.onRRwebEmit = (event) => {
                                    if (win.cancelledDuringStartup && event.type === 2) win.forwardedAfterCancel = true
                                    emit(event)
                                }
                                return recorder
                            }
                            win.nativeStyleGetter = Object.getOwnPropertyDescriptor(
                                CSSStyleRule.prototype,
                                'style'
                            )!.get
                        })
                    },
                    flagsResponseOverrides: { sessionRecording: { endpoint: '/ses/' }, autocapture_opt_out: true },
                },
                page,
                context
            )
            await waitForSessionRecordingToStart(page)
            await page.evaluate(() => {
                const win = window as FixtureWindow
                const record = win.__PosthogExtensions__!.rrweb!.record
                win.rotationEvents = []
                win.__PosthogExtensions__!.rrweb!.record = Object.assign(
                    (options: Parameters<typeof record>[0]) =>
                        record({
                            ...options,
                            emit: (event) => {
                                win.rotationEvents.push(event)
                                options.emit?.(event)
                            },
                        }),
                    record
                )
                const fallback = document.createElement('style')
                fallback.textContent = '#rotation-card { padding: 0; }'
                document.head.append(fallback)
                const card = document.createElement('button')
                card.id = 'rotation-card'
                card.textContent = 'Rotation fixture'
                document.body.append(card)
                win.rotationSheet = new CSSStyleSheet()
                win.rotationSheet.replaceSync(
                    ':root { --rotation-padding: 8px; --rotation-other: 16px; } #rotation-card { padding: var(--rotation-padding); padding-left: 12px; }'
                )
                document.adoptedStyleSheets = [...document.adoptedStyleSheets, win.rotationSheet]
            })
            await page.locator('#rotation-card').click()
            const ids = await page.evaluate((mode) => {
                const win = window as FixtureWindow
                const before = win.posthog.get_session_id()
                win.posthog.set_config({
                    before_send: (event) => {
                        if (event?.event === '$snapshot' && win.mutateOnRotation) {
                            win.mutateOnRotation = false
                            win.mutatedOnRotation = true
                            if (mode === 'callback-stop') win.posthog.stopSessionRecording()
                            else if (mode === 'callback-optout') win.posthog.opt_out_capturing()
                            else {
                                const style = (win.rotationSheet.cssRules[1] as CSSStyleRule).style
                                style.padding = 'var(--rotation-other)'
                                style.paddingLeft = '12px'
                            }
                        }
                        return null
                    },
                })
                win.mutateOnRotation = mode.startsWith('callback-')
                win.stopInSnapshot = mode.startsWith('startup-')
                if (win.stopInSnapshot) {
                    win.posthog.set_config({
                        session_recording: {
                            ...win.posthog.config.session_recording,
                            maskTextSelector: '#rotation-card',
                            maskTextFn: (_text, element) => {
                                if (win.stopInSnapshot && element?.id === 'rotation-card') {
                                    win.stopInSnapshot = false
                                    win.mutatedOnRotation = true
                                    win.cancelledDuringStartup = true
                                    if (mode === 'startup-stop') win.posthog.stopSessionRecording()
                                    else win.posthog.opt_out_capturing()
                                }
                                return '***'
                            },
                        },
                    })
                }
                win.posthog.sessionManager!.resetSessionId()
                return { before, after: win.posthog.get_session_id() }
            }, mode)
            expect(ids.after).not.toBe(ids.before)
            if (mode === 'callback-stop' || mode === 'callback-optout' || mode.startsWith('startup-')) {
                expect(await page.evaluate(() => (window as FixtureWindow).mutatedOnRotation)).toBe(true)
                expect(await page.evaluate(() => (window as FixtureWindow).posthog.sessionRecording!.started)).toBe(
                    false
                )
                if (mode.startsWith('callback-')) {
                    expect(await page.evaluate(() => (window as FixtureWindow).rotationEvents.length)).toBe(0)
                }
                expect(
                    await page.evaluate(() =>
                        (window as FixtureWindow).__PosthogExtensions__!.rrweb!.record.isRecording?.()
                    )
                ).toBe(false)
                expect(await page.evaluate(() => (window as FixtureWindow).forwardedAfterCancel)).toBe(false)
                expect(
                    await page.evaluate(
                        () =>
                            Object.getOwnPropertyDescriptor(CSSStyleRule.prototype, 'style')!.get ===
                            (window as FixtureWindow).nativeStyleGetter
                    )
                ).toBe(true)
                return
            }
            await waitForSessionRecordingToStart(page)
            await page.evaluate(() => {
                const win = window as FixtureWindow
                win.__PosthogExtensions__!.rrweb!.record.takeFullSnapshot()
                win.posthog.stopSessionRecording()
            })
            await page.addScriptTag({ path: path.resolve(__dirname, '../../../../rrweb/rrweb/dist/rrweb.umd.cjs') })
            const result = await page.evaluate(async () => {
                const win = window as FixtureWindow
                const root = document.createElement('div')
                document.body.append(root)
                const replay = new win.rrweb.Replayer(win.rotationEvents, { root, mouseTail: false })
                replay.pause(
                    win.rotationEvents[win.rotationEvents.length - 1].timestamp - win.rotationEvents[0].timestamp + 100
                )
                await new Promise((resolve) => setTimeout(resolve, 50))
                const doc = replay.iframe.contentDocument!
                const padding = doc.defaultView!.getComputedStyle(doc.querySelector('#rotation-card')!).paddingTop
                replay.destroy()
                root.remove()
                // Invalidation must use current native CSS, not stale source; CSSOM loss varies by engine.
                const oracle = document.createElement('div')
                oracle.id = 'rotation-oracle'
                const style = document.createElement('style')
                style.textContent =
                    '#rotation-oracle { padding: 0; }' +
                    win.rotationSheet.cssRules[1].cssText.replace('#rotation-card', '#rotation-oracle')
                document.body.append(style, oracle)
                const nativePadding = getComputedStyle(oracle).paddingTop
                style.remove()
                oracle.remove()
                return {
                    padding,
                    nativePadding,
                    live: getComputedStyle(document.querySelector('#rotation-card')!).paddingTop,
                    mutated: !!win.mutatedOnRotation,
                }
            })
            expect(result.padding).toBe(mode === 'unchanged' ? '8px' : result.nativePadding)
            expect(result.live).toBe(mode === 'unchanged' ? '8px' : '16px')
            expect(result.mutated).toBe(mode !== 'unchanged')
        })
    }
})
