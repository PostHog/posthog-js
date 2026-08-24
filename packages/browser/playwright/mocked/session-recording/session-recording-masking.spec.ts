import { test, expect } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { Page } from '@playwright/test'
import { CaptureResult } from '@/types'

// Local config not set
// flags comes back - says we shouldn't mask

const remoteMaskingTextSelector = '*'

const startOptions = (masking: Record<string, any>) => ({
    options: {
        session_recording: {
            // not the default but makes for easier test assertions
            compress_events: false,
        },
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
            masking,
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
})

async function interactWithThePage(page: Page) {
    await page.locator('[data-cy-input]').type('hello posthog!')

    await expect(page.locator(remoteMaskingTextSelector).first()).toBeVisible()
    // there's nothing to wait for... so, just wait a bit
    await page.waitForTimeout(2500)
    // no new events
    const events = await page.capturedEvents()
    const snapshotEvents = events.filter((e) => e.event === '$snapshot')
    expect(snapshotEvents.length).toBeGreaterThan(0)
    return snapshotEvents
}

function assertTheConfigIsAsExpected(snapshotEvents: CaptureResult[], expectedMasking: Record<string, any>) {
    // first we can check that remote config is received and used as expected
    const allRRWebSnapshots = snapshotEvents.flatMap((e) => e.properties['$snapshot_data'])
    const customSnapshots = allRRWebSnapshots.filter((s) => s.type === 5)

    const remoteConfigReceived = customSnapshots.filter((s) => s.data.tag === '$remote_config_received')[0].data.payload
    const sessionOptions = customSnapshots.filter((s) => s.data.tag === '$session_options')[0].data.payload

    expect(remoteConfigReceived.masking.maskAllInputs).toBe(expectedMasking.maskAllInputs)
    expect(remoteConfigReceived.masking.maskTextSelector).toBe(expectedMasking.maskTextSelector)

    expect(sessionOptions.sessionRecordingOptions.maskAllInputs).toBe(expectedMasking.maskAllInputs)
    expect(sessionOptions.sessionRecordingOptions.maskTextSelector).toBe(expectedMasking.maskTextSelector)
}

test.describe('Session recording - masking', () => {
    test('sanitizes JSON-LD in emitted browser events', async ({ page, context }) => {
        await page.addInitScript(() => {
            const appendInitialJsonLd = () => {
                const appendJsonLd = (value: Record<string, unknown>, className = '') => {
                    const script = document.createElement('script')
                    script.type = 'application/ld+json'
                    script.className = className
                    script.setAttribute('data-private', 'PRIVATE_ATTRIBUTE')
                    script.textContent = JSON.stringify(value)
                    script.append(document.createComment('PRIVATE_COMMENT'))
                    document.head.append(script)
                }
                appendJsonLd({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    name: 'ALLOWED_INITIAL_PRODUCT',
                    email: 'PRIVATE_UNAPPROVED_EMAIL',
                    description: 'PRIVATE_DESCRIPTION',
                    url: 'https://example.com/?token=PRIVATE_URL_TOKEN',
                    brand: {
                        '@type': 'Person',
                        name: 'PRIVATE_NESTED_PERSON',
                    },
                })
                appendJsonLd(
                    {
                        '@context': 'https://schema.org',
                        '@type': 'Product',
                        name: 'PRIVATE_MASKED_PRODUCT',
                    },
                    'json-ld-mask'
                )
            }
            const appendWhenHeadExists = () => {
                if (document.head) {
                    document.onreadystatechange = null
                    appendInitialJsonLd()
                }
            }
            if (document.head) {
                appendInitialJsonLd()
            } else {
                document.onreadystatechange = appendWhenHeadExists
            }
        })
        const options = startOptions({
            maskAllInputs: true,
            maskTextSelector: '.json-ld-mask',
        })
        await start(options, page, context)
        await waitForSessionRecordingToStart(page)

        await page.evaluate(() => {
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.append(document.createTextNode('{"@context":"https://schema.org",'))
            script.append(
                document.createTextNode(
                    '"@type":"Product","name":"ALLOWED_DYNAMIC_PRODUCT","email":"PRIVATE_DYNAMIC_EMAIL"}'
                )
            )
            document.head.append(script)
        })
        await page.locator('[data-cy-input]').type('flush recording')
        await page.waitForTimeout(2500)

        const eventBytes = JSON.stringify(
            (await page.capturedEvents())
                .filter((event) => event.event === '$snapshot')
                .flatMap((event) => event.properties['$snapshot_data'])
        )
        expect(eventBytes).toContain('ALLOWED_INITIAL_PRODUCT')
        expect(eventBytes).toContain('ALLOWED_DYNAMIC_PRODUCT')
        for (const privateMarker of [
            'PRIVATE_ATTRIBUTE',
            'PRIVATE_COMMENT',
            'PRIVATE_UNAPPROVED_EMAIL',
            'PRIVATE_DESCRIPTION',
            'PRIVATE_URL_TOKEN',
            'PRIVATE_NESTED_PERSON',
            'PRIVATE_MASKED_PRODUCT',
            'PRIVATE_DYNAMIC_EMAIL',
        ]) {
            expect(eventBytes).not.toContain(privateMarker)
        }
    })

    test('masks text', async ({ page, context }) => {
        await start(
            startOptions({
                maskAllInputs: true,
                maskTextSelector: remoteMaskingTextSelector,
            }),
            page,
            context
        )

        const snapshotEvents = await interactWithThePage(page)

        assertTheConfigIsAsExpected(snapshotEvents, {
            maskAllInputs: true,
            maskTextSelector: remoteMaskingTextSelector,
        })

        const snapshotData = snapshotEvents.map((e) => JSON.stringify(e.properties?.['$snapshot_data']))

        const snapshotsThatIncludeMaskedContent = snapshotData.filter((data) => {
            const includesMaskedInput = !!data?.includes('hello posthog!')

            const includesMaskedText = !!data?.includes('just some text')

            return includesMaskedInput || includesMaskedText
        })

        expect(snapshotsThatIncludeMaskedContent.length).toBe(0)
    })

    test('unmasks inputs', async ({ page, context }) => {
        await start(
            startOptions({
                maskAllInputs: false,
                maskTextSelector: remoteMaskingTextSelector,
            }),
            page,
            context
        )

        const snapshotEvents = await interactWithThePage(page)

        assertTheConfigIsAsExpected(snapshotEvents, {
            maskAllInputs: false,
            maskTextSelector: remoteMaskingTextSelector,
        })

        const snapshotData = snapshotEvents.map((e) => JSON.stringify(e.properties?.['$snapshot_data']))

        const snapshotsThatIncludeMaskedContent = snapshotData.filter((data) => {
            const includesMaskedInput = !!data?.includes('hello posthog!')

            const includesMaskedText = !!data?.includes('just some text')

            return includesMaskedInput || includesMaskedText
        })

        expect(snapshotsThatIncludeMaskedContent.length).toBe(1)
    })
})
