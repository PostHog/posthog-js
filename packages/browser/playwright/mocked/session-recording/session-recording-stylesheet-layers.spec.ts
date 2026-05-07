import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {
            compress_events: false,
        },
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/css-layers/index.html',
}

function findNodeById(node: any, id: string): any | null {
    if (node?.attributes?.id === id) {
        return node
    }
    if (node?.childNodes) {
        for (const child of node.childNodes) {
            const found = findNodeById(child, id)
            if (found) {
                return found
            }
        }
    }
    return null
}

function findStyleTextById(node: any, id: string): string {
    if (node?.attributes?.id === id && node.tagName === 'style') {
        for (const child of node.childNodes ?? []) {
            if (child.type === 3) return child.textContent ?? ''
        }
        return ''
    }
    for (const child of node?.childNodes ?? []) {
        const found = findStyleTextById(child, id)
        if (found) return found
    }
    return ''
}

test.describe('Session recording captures CSS @layer rules', () => {
    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })
        await waitForSessionRecordingToStart(page)
        await page.resetCapturedEvents()
    })

    test('atomic utilities inside @layer survive the FullSnapshot', async ({ page }) => {
        const responsePromise = page.waitForResponse('**/ses/*')
        await page.locator('[data-cy-input]').type('hello posthog!')
        await responsePromise

        const events = await page.capturedEvents()
        const snapshot = events.find((e) => e.event === '$snapshot')
        expect(snapshot).toBeDefined()

        const fullSnapshot = (snapshot!['properties']['$snapshot_data'] as any[]).find((s) => s.type === 2)
        expect(fullSnapshot).toBeDefined()

        const styleNode = findNodeById(fullSnapshot.data.node, 'panda-emulated')
        expect(styleNode).not.toBeNull()

        const cssText: string = styleNode.attributes._cssText ?? ''

        // sanity: base layer rule from non-layout territory
        expect(cssText).toContain('.card')
        expect(cssText).toContain('border-radius')

        // the symptom the customer reports: layout utilities inside @layer utilities
        expect(cssText).toContain('.p_8')
        expect(cssText).toContain('padding: 32px')
        expect(cssText).toContain('.flex')
        expect(cssText).toContain('display: flex')
        expect(cssText).toContain('.items_center')
        expect(cssText).toContain('align-items: center')
        expect(cssText).toContain('.grid_cols_2')
        expect(cssText).toContain('grid-template-columns')
        expect(cssText).toContain('1fr 1fr')

        // nested @media inside @layer utilities (Panda's responsive variants)
        expect(cssText).toContain('.md')
        expect(cssText).toContain('p_16')
        expect(cssText).toContain('padding: 64px')
    })

    test('shorthand-with-var()-plus-longhand-override does not produce empty longhands', async ({ page }) => {
        const responsePromise = page.waitForResponse('**/ses/*')
        await page.locator('[data-cy-input]').type('hello posthog!')
        await responsePromise

        const events = await page.capturedEvents()
        const snapshot = events.find((e) => e.event === '$snapshot')
        const fullSnapshot = (snapshot!['properties']['$snapshot_data'] as any[]).find((s) => s.type === 2)
        const styleText = findStyleTextById(fullSnapshot.data.node, 'chakra-emulated')

        // sanity: rule is captured
        expect(styleText).toContain('.chakra-card')

        // The customer's failure mode at app.sonia.so/login:
        //
        //   live <style> text:  .chakra-card { padding: var(--x); padding-bottom: var(--y); ... }
        //   captured <style>:   .chakra-card { padding-top: ; padding-right: ; padding-left: ;
        //                                       padding-bottom: var(--y); ... }
        //
        // Chromium's rule.cssText can't statically expand `padding: var(--x)` into per-axis
        // longhand values, so when there is an explicit override on one axis it emits empty
        // placeholder longhands for the other three. The fix in serializeTextNode detects
        // that pattern in stringifyStylesheet's output and falls back to the original
        // textContent so the layout-relevant CSS survives into replay.
        expect(styleText).not.toMatch(/padding-(top|right|bottom|left)\s*:\s*;/)

        // both the shorthand and the override survive verbatim now
        expect(styleText).toMatch(/padding\s*:\s*var\(--chakra-spacing-8\)/)
        expect(styleText).toMatch(/padding-bottom\s*:\s*var\(--chakra-spacing-12\)/)
    })

    test('hybrid <style> (seeded text + insertRule) captures both when the round-trip is clean', async ({ page }) => {
        // When stringifyStylesheet's output does not trigger the
        // empty-shorthand-longhand fallback, the existing path captures every rule
        // in the sheet — including ones added via insertRule on top of seeded text.
        // This is the regression check for the corruption-detection branch: it
        // must not over-fire on clean rules and lose insertRule additions.
        const responsePromise = page.waitForResponse('**/ses/*')
        await page.locator('[data-cy-input]').type('hello posthog!')
        await responsePromise

        const events = await page.capturedEvents()
        const snapshot = events.find((e) => e.event === '$snapshot')
        const fullSnapshot = (snapshot!['properties']['$snapshot_data'] as any[]).find((s) => s.type === 2)
        const styleText = findStyleTextById(fullSnapshot.data.node, 'hybrid-emulated')

        // seeded rule survives
        expect(styleText).toContain('.hybrid-base')
        expect(styleText).toContain('color: red')
        // rule appended later via insertRule is also captured
        expect(styleText).toContain('.hybrid-late')
        expect(styleText).toContain('color: blue')
    })
})
