import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilEventCaptured } from './utils/event-capture-utils'

const startOptions = {
    options: {
        capture_dead_clicks: true,
    },
    url: '/playground/cypress/index.html',
}

test.describe('Dead clicks', () => {
    test('capture dead clicks when configured to', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.locator('[data-cy-not-an-order-button]').click()

        await pollUntilEventCaptured(page, '$dead_click')

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(1)
        const deadClick = deadClicks[0]

        // this assertion flakes, sometimes there is no $dead_click_last_mutation_timestamp
        //expect(deadClick.properties.$dead_click_last_mutation_timestamp).toBeGreaterThan(0)
        expect(deadClick.properties.$dead_click_event_timestamp).toBeGreaterThan(0)
        expect(deadClick.properties.$dead_click_absolute_delay_ms).toBeGreaterThan(0)
        expect(deadClick.properties.$dead_click_scroll_timeout).toBe(false)
        expect(deadClick.properties.$dead_click_mutation_timeout).toBe(false)
        expect(deadClick.properties.$dead_click_absolute_timeout).toBe(true)
    })

    test('does not report synchronous DOM updates before a window bubble listener as dead clicks', async ({
        page,
        context,
    }) => {
        await context.addInitScript(() => {
            window.onclick = () => {
                const started = performance.now()
                while (performance.now() - started < 8) {
                    // Keep the earlier bubble listener busy for a deterministic ordering regression.
                }
            }
        })
        await start(
            {
                ...startOptions,
                options: { capture_dead_clicks: { mutation_threshold_ms: 300 } },
            },
            page,
            context
        )
        await page.waitForFunction(
            () => !!(window as WindowWithPostHog).posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
        )
        await page.evaluate(() => {
            const button = document.createElement('button')
            button.id = 'mutating-button'
            button.textContent = 'Next day'
            const label = document.createElement('span')
            label.id = 'mutating-label'
            label.textContent = 'Day 1'
            button.onclick = () => {
                label.textContent = 'Day 2'
            }
            document.body.append(button, label)
        })
        await page.waitForTimeout(1100)
        await page.resetCapturedEvents()

        await page.locator('#mutating-button').click()
        await expect(page.locator('#mutating-label')).toHaveText('Day 2')
        await page.waitForTimeout(1500)
        expect((await page.capturedEvents()).filter((event) => event.event === '$dead_click')).toHaveLength(0)

        await page.locator('[data-cy-not-an-order-button]').click()
        await pollUntilEventCaptured(page, '$dead_click')
        expect((await page.capturedEvents()).filter((event) => event.event === '$dead_click')).toHaveLength(1)
    })

    test('stops capturing dead clicks while disabled and captures once after restarting', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: { capture_dead_clicks: { mutation_threshold_ms: 300 } },
            },
            page,
            context
        )
        await page.waitForFunction(
            () => !!(window as WindowWithPostHog).posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
        )
        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.set_config({ capture_dead_clicks: false })
        })
        await page.waitForTimeout(1100)
        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click()
        await page.waitForTimeout(1500)
        expect((await page.capturedEvents()).filter((event) => event.event === '$dead_click')).toHaveLength(0)

        await page.evaluate(() => {
            const posthog = (window as WindowWithPostHog).posthog
            posthog?.set_config({ capture_dead_clicks: { mutation_threshold_ms: 300 } })
            posthog?.set_config({ capture_dead_clicks: false })
            posthog?.set_config({ capture_dead_clicks: { mutation_threshold_ms: 300 } })
        })
        await page.locator('[data-cy-not-an-order-button]').click()
        await pollUntilEventCaptured(page, '$dead_click')
        await page.waitForTimeout(1500)
        expect((await page.capturedEvents()).filter((event) => event.event === '$dead_click')).toHaveLength(1)
    })

    test('does not capture a dead click when a fallback observer sees a DOM update', async ({ page, context }) => {
        await context.addInitScript(() => {
            // Force getNativeMutationObserverImplementation through its iframe fallback.
            ;(window as any).Zone = {}
        })
        await start(
            {
                options: {
                    capture_dead_clicks: {
                        mutation_threshold_ms: 300,
                    },
                },
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )

        await page.waitForFunction(() => {
            const win = window as any
            return !!win.posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
        })

        await page.evaluate(() => {
            const button = document.createElement('button')
            button.id = 'mutating-button'
            button.textContent = 'Next day'
            const label = document.createElement('span')
            label.id = 'mutating-label'
            label.textContent = 'Day 1'
            button.onclick = () => {
                label.textContent = 'Day 2'
            }
            document.body.append(button, label)
        })

        await page.waitForTimeout(100)
        await page.resetCapturedEvents()

        await page.locator('#mutating-button').click()
        await expect(page.locator('#mutating-label')).toHaveText('Day 2')
        await page.waitForTimeout(1500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks).toHaveLength(0)
    })

    test('captures dead swipes when configured to', async ({ page, context }) => {
        await start(startOptions, page, context)

        const target = page.locator('[data-cy-not-an-order-button]')
        await target.evaluate((element) => {
            const boundingBox = element.getBoundingClientRect()
            const start = { clientX: boundingBox.x + boundingBox.width / 2, clientY: boundingBox.y + 10 }
            const end = { clientX: start.clientX, clientY: start.clientY + 100 }

            const dispatchTouch = (eventType: 'touchstart' | 'touchend', touch: typeof start): void => {
                const event = new Event(eventType, { bubbles: true, cancelable: true })
                Object.defineProperty(event, eventType === 'touchstart' ? 'touches' : 'changedTouches', {
                    value: [touch],
                })
                element.dispatchEvent(event)
            }

            dispatchTouch('touchstart', start)
            dispatchTouch('touchend', end)
        })

        await pollUntilEventCaptured(page, '$dead_swipe')

        const deadSwipes = (await page.capturedEvents()).filter((event) => event.event === '$dead_swipe')
        expect(deadSwipes).toHaveLength(1)
        expect(deadSwipes[0].properties.$dead_swipe_direction).toBe('down')
        expect(deadSwipes[0].properties.$dead_swipe_distance_px).toBe(100)
        expect(deadSwipes[0].properties.$dead_swipe_absolute_timeout).toBe(true)
    })

    test('does not capture dead click when ctrl key is held', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Control'] })

        // wait long enough for a dead click to be detected if it was going to be
        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('does not capture dead click when meta/cmd key is held', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Meta'] })

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('does not capture dead click when shift key is held', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Shift'] })

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('does not capture dead click when alt key is held', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Alt'] })

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('captures dead click with modifier key when capture_clicks_with_modifier_keys is true', async ({
        page,
        context,
    }) => {
        await start(
            {
                options: {
                    capture_dead_clicks: {
                        capture_clicks_with_modifier_keys: true,
                    },
                },
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )

        // Wait for dead clicks extension to be fully loaded
        await page.waitForFunction(
            () => {
                const win = window as any
                return !!win.posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
            },
            { timeout: 10000 }
        )

        await page.resetCapturedEvents()

        // Use Shift modifier since Ctrl+Click triggers contextmenu instead of click in some browsers
        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Shift'] })

        await pollUntilEventCaptured(page, '$dead_click')

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(1)
    })

    test('does not capture dead click when visibility changes to visible after click', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click()

        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
            document.dispatchEvent(new Event('visibilitychange'))
        })

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('does not capture dead click when visibility changes to visible just before click', async ({
        page,
        context,
    }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
            document.dispatchEvent(new Event('visibilitychange'))
        })

        await page.locator('[data-cy-not-an-order-button]').click()

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    for (const { tag, label, mode, holdMs } of (
        [
            { tag: 'input', label: 'input', mode: undefined },
            { tag: 'textarea', label: 'textarea', mode: undefined },
            { tag: 'div', label: 'contenteditable text', mode: undefined },
            { tag: 'div', label: 'shadow-root contenteditable text', mode: 'open' },
            { tag: 'div', label: 'closed-shadow-root contenteditable text', mode: 'closed' },
        ] as const
    ).flatMap((editor) => [30, 150, 2670].map((holdMs) => ({ ...editor, holdMs })))) {
        test(`classifies caret placement in ${label} with a ${holdMs}ms press`, async ({ page, context }) => {
            await start(startOptions, page, context)
            await page.waitForFunction(() => {
                const win = window as any
                return !!win.posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
            })
            const editor = await page.evaluateHandle(
                ({ tag, mode }) => {
                    const editor = document.createElement(tag)
                    editor.id = 'text-editor'
                    editor.style.cssText = 'position: fixed; top: 20px; left: 20px; width: 400px; padding: 24px;'
                    if (tag === 'div') {
                        editor.setAttribute('contenteditable', 'true')
                        const text = document.createElement('span')
                        text.textContent = 'Place a caret here'
                        editor.appendChild(text)
                    } else {
                        const input = editor as HTMLInputElement | HTMLTextAreaElement
                        input.value = 'Place a caret here'
                        input.setSelectionRange(0, 0)
                    }
                    if (mode) {
                        const host = document.createElement('div')
                        host.attachShadow({ mode }).appendChild(editor)
                        document.body.appendChild(host)
                    } else {
                        document.body.appendChild(editor)
                    }
                    return editor
                },
                { tag, mode }
            )
            await page.waitForTimeout(1100)
            await page.resetCapturedEvents()

            const point = await editor.evaluate((element) => {
                const rect = element.getBoundingClientRect()
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
            })
            await page.mouse.move(point.x, point.y)
            await page.mouse.down()
            expect(
                await editor.evaluate(
                    (element) => element === (element.getRootNode() as Document | ShadowRoot).activeElement
                )
            ).toBe(true)
            expect(
                await editor.evaluate((element) => {
                    if (element.tagName === 'DIV') {
                        return window.getSelection()?.type === 'Caret'
                    }
                    const input = element as HTMLInputElement | HTMLTextAreaElement
                    return (
                        input.selectionStart !== null &&
                        input.selectionStart > 0 &&
                        input.selectionStart === input.selectionEnd
                    )
                })
            ).toBe(true)
            const exposesCaretOwner = await editor.evaluate((element) =>
                element.contains(window.getSelection()?.focusNode ?? null)
            )
            await page.waitForTimeout(holdMs)
            await page.mouse.up()
            await page.waitForTimeout(3500)

            const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
            // An opaque closed-root caret is indistinguishable from an inert focused host.
            // Preserve its timed fallback instead of extending that ambiguity across a hold.
            const opaqueLongPress = mode === 'closed' && holdMs > 100 && !exposesCaretOwner
            expect(deadClicks).toHaveLength(opaqueLongPress ? 1 : 0)
        })
    }

    for (const { clickLocation, focusable, holdMs = 30 } of [
        { clickLocation: 'text', focusable: false },
        { clickLocation: 'padding', focusable: false },
        { clickLocation: 'text', focusable: true },
        { clickLocation: 'padding', focusable: true },
        { clickLocation: 'text', focusable: false, holdMs: 2670 },
        { clickLocation: 'padding', focusable: true, holdMs: 2670 },
    ]) {
        test(`captures a dead click on inert selectable ${clickLocation}${focusable ? ' in a focusable container' : ''} with a ${holdMs}ms press`, async ({
            page,
            context,
        }) => {
            await start(startOptions, page, context)
            await page.waitForFunction(() => {
                const win = window as any
                return !!win.posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
            })

            await page.evaluate(
                ({ location, focusable }) => {
                    const element = document.createElement('div')
                    element.id = 'inert-selectable'
                    element.textContent = 'Inert selectable text'
                    if (focusable) {
                        element.tabIndex = 0
                    }
                    element.style.cssText =
                        'position: fixed; top: 20px; left: 20px; width: 400px; padding: 24px; background: white;'
                    document.body.appendChild(element)
                    window.getSelection()?.removeAllRanges()
                    if (location === 'padding') {
                        const input = document.createElement('input')
                        input.value = 'Focused editor'
                        document.body.appendChild(input)
                        input.focus()
                        input.setSelectionRange(0, 0)
                    }
                },
                { location: clickLocation, focusable }
            )

            // Let setup mutations and focus changes fall outside the click's observation window.
            await page.waitForTimeout(1100)
            await page.resetCapturedEvents()
            expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true)

            const point = await page.locator('#inert-selectable').evaluate((element, location) => {
                if (location === 'padding') {
                    const rect = element.getBoundingClientRect()
                    return { x: rect.right - 5, y: rect.bottom - 5 }
                }
                const range = document.createRange()
                range.setStart(element.firstChild!, 0)
                range.setEnd(element.firstChild!, 1)
                const rect = range.getBoundingClientRect()
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
            }, clickLocation)

            await page.mouse.click(point.x, point.y, { delay: holdMs })
            expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true)
            await page.waitForTimeout(3500)

            const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
            expect(deadClicks).toHaveLength(1)
        })
    }

    for (const mode of [undefined, 'open', 'closed'] as const) {
        for (const holdMs of [30, 150, 2670]) {
            test(`does not capture dead clicks when selecting and unselecting ${mode ?? 'light'}-root text with a ${holdMs}ms press`, async ({
                page,
                context,
            }) => {
                await start(startOptions, page, context)
                await page.waitForFunction(() => {
                    const win = window as any
                    return !!win.posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
                })
                const text = await page.evaluateHandle((mode) => {
                    const host = document.createElement('div')
                    host.style.cssText =
                        'position: fixed; top: 20px; left: 20px; width: 400px; padding: 24px; background: white;'
                    const text = document.createElement('span')
                    text.textContent = 'Shadow selection text'
                    ;(mode ? host.attachShadow({ mode }) : host).appendChild(text)
                    document.body.appendChild(host)
                    return text
                }, mode)
                await page.waitForTimeout(1100)
                await page.resetCapturedEvents()

                const point = await text.evaluate((element) => {
                    const range = document.createRange()
                    range.setStart(element.firstChild!, 1)
                    range.setEnd(element.firstChild!, 2)
                    const rect = range.getBoundingClientRect()
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
                })
                await page.mouse.dblclick(point.x, point.y, { delay: 30 })
                await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Shadow')
                await page.waitForTimeout(3500)
                expect((await page.capturedEvents()).filter((event) => event.event === '$dead_click')).toHaveLength(0)

                await page.resetCapturedEvents()
                const outsideSelection = await text.evaluate((element) => {
                    const node = element.firstChild!
                    const range = document.createRange()
                    range.setStart(node, node.textContent!.length - 1)
                    range.setEnd(node, node.textContent!.length)
                    const rect = range.getBoundingClientRect()
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
                })
                await page.mouse.move(outsideSelection.x, outsideSelection.y)
                await page.mouse.down()
                await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('')
                await page.waitForTimeout(holdMs)
                await page.mouse.up()
                await page.waitForTimeout(3500)
                expect((await page.capturedEvents()).filter((event) => event.event === '$dead_click')).toHaveLength(0)
            })
        }
    }

    for (const scenario of ['closed inert host', 'unrelated range removal', 'nested text clearing']) {
        test(`keeps gesture selection scoped for ${scenario}`, async ({ page, context }) => {
            await start(startOptions, page, context)
            await page.waitForFunction(() => {
                const win = window as any
                return !!win.posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
            })
            await page.evaluate((scenario) => {
                const target = document.createElement('div')
                target.id = 'gesture-target'
                target.style.cssText =
                    'position: fixed; left: 20px; top: 20px; width: 400px; padding: 24px; background: white;'
                const span = document.createElement('span')
                span.textContent = 'Nested selectable text'
                if (scenario === 'closed inert host') {
                    target.tabIndex = 0
                    target.attachShadow({ mode: 'closed' }).appendChild(span)
                } else {
                    target.appendChild(span)
                }
                document.body.appendChild(target)
                const selection = window.getSelection()!
                selection.removeAllRanges()
                if (scenario !== 'closed inert host') {
                    const other = document.createElement('span')
                    other.textContent = 'Unrelated selected text'
                    document.body.appendChild(other)
                    const range = document.createRange()
                    range.selectNodeContents(scenario === 'unrelated range removal' ? other : span)
                    selection.addRange(range)
                }
                if (scenario === 'unrelated range removal') {
                    target.onmousedown = (event) => event.preventDefault()
                }
            }, scenario)
            await page.waitForTimeout(1100)
            await page.resetCapturedEvents()
            const box = await page.locator('#gesture-target').boundingBox()
            expect(box).not.toBeNull()
            await page.mouse.move(box!.x + box!.width - 8, box!.y + box!.height / 2)
            await page.mouse.down()
            if (scenario === 'unrelated range removal') {
                await page.evaluate(() => window.getSelection()!.removeAllRanges())
            }
            await page.waitForTimeout(150)
            await page.mouse.up()
            await page.waitForTimeout(3500)
            expect((await page.capturedEvents()).filter((event) => event.event === '$dead_click')).toHaveLength(
                scenario === 'nested text clearing' ? 0 : 1
            )
        })
    }

    test('does not capture dead click for selected text', async ({ page, context }) => {
        await start(startOptions, page, context)
        await page.waitForFunction(() => {
            const win = window as any
            return !!win.posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
        })

        await page.resetCapturedEvents()

        const locator = page.locator('[data-cy-dead-click-text]')
        const boundingBox = await locator.boundingBox()
        if (!boundingBox) {
            throw new Error('must get a bounding box')
        }
        const position = boundingBox.x + boundingBox.width / 2
        const wordToSelectLength = 50

        await page.mouse.move(position, boundingBox.y)

        await page.mouse.down()
        await page.mouse.move(position + wordToSelectLength, boundingBox.y)
        await page.mouse.up()
        await page.mouse.dblclick(position, boundingBox.y)

        const selection = await page.evaluate(() => window.getSelection()?.toString())
        expect(selection?.trim().length).toBeGreaterThan(0)

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks).toHaveLength(0)
    })

    test('does not capture a dead click when a click unselects text', async ({ page, context }) => {
        await start(startOptions, page, context)
        await page.waitForFunction(() => {
            const win = window as any
            return !!win.posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
        })

        const text = page.locator('[data-cy-dead-click-text]')
        await text.evaluate((element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            const selection = window.getSelection()
            selection?.removeAllRanges()
            selection?.addRange(range)
        })
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).not.toBe('')

        // Keep the selection that created the initial event, but move it outside the suppression
        // window. The click's own selectionchange must be what suppresses the dead click.
        await page.waitForTimeout(200)
        await page.resetCapturedEvents()

        await text.click({ delay: 30 })
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('')

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks).toHaveLength(0)
    })
})
