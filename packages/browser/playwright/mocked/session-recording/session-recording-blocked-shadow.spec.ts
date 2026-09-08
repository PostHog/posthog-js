import { test, expect } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

for (const kind of ['light', 'shadow', 'nested-shadow'] as const) {
    for (const blocking of ['class', 'selector'] as const) {
        for (const moves of [0, 1, 2]) {
            test(`does not emit ${kind} descendants when held moves block their ancestor by ${blocking} (${moves} held moves)`, async ({
                page,
                context,
            }) => {
                await start(
                    {
                        options: { session_recording: { compress_events: false } },
                        flagsResponseOverrides: {
                            sessionRecording: {
                                endpoint: '/ses/',
                                masking: {
                                    maskAllInputs: true,
                                    maskTextSelector: '.ph-mask',
                                    blockSelector: blocking === 'selector' ? '[data-test-blocked]' : undefined,
                                },
                            },
                            capturePerformance: false,
                            autocapture_opt_out: true,
                        },
                        url: './playground/cypress/index.html',
                    },
                    page,
                    context
                )
                await waitForSessionRecordingToStart(page)
                await page.locator('[data-cy-input]').fill('activate recording')
                const { rootId, textId } = await page.evaluate((kind) => {
                    const record = (window as any).__PosthogExtensions__.rrweb.record
                    const origin = document.createElement('section')
                    const destination = document.createElement('section')
                    const root = document.createElement('div')
                    root.setAttribute('data-held-phase', 'initial')
                    let content: Element | ShadowRoot = root
                    for (let level = 0; level < (kind === 'nested-shadow' ? 2 : kind === 'shadow' ? 1 : 0); level++) {
                        const host = document.createElement('div')
                        content.append(host)
                        content = host.attachShadow({ mode: 'open' })
                    }
                    const span = document.createElement('span')
                    const text = document.createTextNode('PUBLIC_BEFORE_HELD_MOVE')
                    span.append(text)
                    content.append(span)
                    origin.append(root)
                    document.body.append(origin, destination)
                    record.takeFullSnapshot()
                    ;(window as any).__heldShadowTest = { record, origin, destination, root, text, span, content }
                    return { rootId: record.mirror.getId(root), textId: record.mirror.getId(text) }
                }, kind)
                expect(rootId).toBeGreaterThan(0)
                expect(textId).toBeGreaterThan(0)

                const events = async () =>
                    (await page.capturedEvents())
                        .filter((event) => event.event === '$snapshot')
                        .flatMap((event) => event.properties['$snapshot_data'])
                await expect.poll(async () => JSON.stringify(await events())).toContain('PUBLIC_BEFORE_HELD_MOVE')

                await page.evaluate(
                    async ({ blocking, moves }) => {
                        const { record, origin, destination, root, text } = (window as any).__heldShadowTest
                        const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
                        const assertHeld = () => {
                            if (record.mirror.getMeta(root).attributes['data-held-phase'] !== 'initial') {
                                throw new Error('Recording unexpectedly flushed before the held-move checkpoint')
                            }
                        }
                        record.freezePage()
                        root.setAttribute('data-held-phase', 'held')
                        if (moves > 0) destination.append(root)
                        await settle()
                        assertHeld()
                        if (blocking === 'class') root.classList.add('ph-no-capture')
                        else root.setAttribute('data-test-blocked', '')
                        text.data = 'PRIVATE_AFTER_HELD_BLOCK'
                        if (moves === 2) origin.append(root)
                        await settle()
                        assertHeld()
                        // Non-mutation rrweb events release the frozen buffers.
                        record.addCustomEvent('held-shadow-checkpoint', 'blocked')
                    },
                    { blocking, moves }
                )
                await expect
                    .poll(async () =>
                        (await events()).some(
                            (e) =>
                                e.type === 5 && e.data.tag === 'held-shadow-checkpoint' && e.data.payload === 'blocked'
                        )
                    )
                    .toBe(true)
                const blockedEvents = await events()
                expect(JSON.stringify(blockedEvents)).not.toContain('PRIVATE_AFTER_HELD_BLOCK')
                if (moves > 0)
                    expect(
                        blockedEvents.some(
                            (e) =>
                                e.type === 3 &&
                                e.data.source === 0 &&
                                e.data.adds.some(
                                    (add) =>
                                        add.node.id === rootId &&
                                        add.node.attributes?.rr_width !== undefined &&
                                        add.node.childNodes.length === 0
                                )
                        )
                    ).toBe(true)

                await page.evaluate(() => {
                    const state = (window as any).__heldShadowTest
                    state.text.data = 'PRIVATE_WHILE_BLOCKED'
                    state.span.setAttribute('title', 'PRIVATE_ATTRIBUTE_WHILE_BLOCKED')
                    const child = document.createElement('b')
                    child.textContent = 'PRIVATE_NEW_CHILD_WHILE_BLOCKED'
                    state.content.append(child)
                    state.privateChild = child
                    setTimeout(() => state.record.addCustomEvent('held-shadow-checkpoint', 'still-blocked'), 0)
                })
                await expect
                    .poll(async () =>
                        (await events()).some(
                            (e) =>
                                e.type === 5 &&
                                e.data.tag === 'held-shadow-checkpoint' &&
                                e.data.payload === 'still-blocked'
                        )
                    )
                    .toBe(true)
                const stillBlockedBytes = JSON.stringify(await events())
                for (const marker of [
                    'PRIVATE_WHILE_BLOCKED',
                    'PRIVATE_ATTRIBUTE_WHILE_BLOCKED',
                    'PRIVATE_NEW_CHILD_WHILE_BLOCKED',
                ])
                    expect(stillBlockedBytes).not.toContain(marker)

                await page.evaluate(() => {
                    const { record, origin, destination, root, text, span, privateChild } = (window as any)
                        .__heldShadowTest
                    privateChild.remove()
                    span.removeAttribute('title')
                    root.classList.remove('ph-no-capture')
                    root.removeAttribute('data-test-blocked')
                    text.data = 'PUBLIC_AFTER_UNBLOCK'
                    // Always change parents; appending an existing last child can be a no-op in WebKit.
                    ;(root.parentNode === destination ? origin : destination).append(root)
                    setTimeout(() => record.addCustomEvent('held-shadow-checkpoint', 'restored'), 0)
                })
                await expect
                    .poll(async () =>
                        (await events()).some(
                            (e) =>
                                e.type === 5 && e.data.tag === 'held-shadow-checkpoint' && e.data.payload === 'restored'
                        )
                    )
                    .toBe(true)
                expect(JSON.stringify(await events())).toContain('PUBLIC_AFTER_UNBLOCK')
                expect(
                    await page.evaluate(() => {
                        const { record, root, text } = (window as any).__heldShadowTest
                        return {
                            rootId: record.mirror.getId(root),
                            textId: record.mirror.getId(text),
                            textMapped: record.mirror.getNode(record.mirror.getId(text)) === text,
                        }
                    })
                ).toEqual({ rootId, textId, textMapped: true })
            })
        }
    }
}
