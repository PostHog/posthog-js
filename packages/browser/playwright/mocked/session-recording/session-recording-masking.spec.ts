import { test, expect } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { Page } from '@playwright/test'
import { CaptureResult } from '@/types'

// Local config not set
// flags comes back - says we shouldn't mask

const remoteMaskingTextSelector = '*'

const startOptions = (masking: Record<string, any>, captureJsonLd = false) => ({
    options: {
        session_recording: {
            // not the default but makes for easier test assertions
            compress_events: false,
            captureJsonLd,
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
    test('emits only sanitized JSON-LD in recording bytes', async ({ page, context }) => {
        await page.addInitScript(() => {
            const appendJsonLd = (value: Record<string, unknown>, className = '') => {
                const script = document.createElement('script')
                script.type = 'application/ld+json'
                script.className = className
                script.setAttribute('data-private', 'PRIVATE_ATTRIBUTE')
                script.textContent = JSON.stringify(value)
                script.append(document.createComment('PRIVATE_COMMENT'))
                document.head.append(script)
            }
            const appendCapturedDomId = (id: string) => {
                const element = document.createElement('div')
                element.id = id
                element.hidden = true
                document.head.append(element)
            }
            const appendInitialJsonLd = () => {
                for (const id of [
                    'ALLOWED_PRODUCT_ID',
                    'ALLOWED_PRIVATE_GRAPH_ID',
                    'DROPPED_CUSTOM_CHILD_ID',
                    'DROPPED_ID_ONLY_NODE_ID',
                ]) {
                    appendCapturedDomId(id)
                }
                appendJsonLd({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    '@id': 'https://private.example/products?token=PRIVATE_ID_URL#ALLOWED_PRODUCT_ID',
                    name: 'ALLOWED_INITIAL_PRODUCT',
                    email: 'PRIVATE_UNAPPROVED_EMAIL',
                    description: 'PRIVATE_DESCRIPTION',
                    url: 'https://example.com/?token=PRIVATE_URL_TOKEN',
                    'PRIVATE_PROPERTY_NAME@example.com': {
                        '@type': 'CustomMetadata',
                        priceCurrency: 'ALLOWED_REDACTED_PROPERTY_DESCENDANT',
                    },
                    brand: {
                        '@type': 'Person',
                        name: 'PRIVATE_NESTED_PERSON',
                    },
                    manufacturer: {
                        '@type': 'Organization',
                        name: 'ALLOWED_MANUFACTURER',
                        legalName: 'ALLOWED_MANUFACTURER_LEGAL_NAME',
                        email: 'PRIVATE_MANUFACTURER_EMAIL',
                    },
                })
                appendJsonLd({
                    '@context': 'https://schema.org',
                    '@graph': [
                        {
                            '@type': 'WebSite',
                            '@id': 'https://private.example/#PRIVATE_MISSING_DOM_ID',
                            inLanguage: 'ALLOWED_GRAPH_LANGUAGE',
                            email: 'PRIVATE_GRAPH_EMAIL',
                        },
                        {
                            '@type': 'PrivateType',
                            '@id': '#ALLOWED_PRIVATE_GRAPH_ID',
                            name: 'PRIVATE_GRAPH_ENTITY',
                            customChild: {
                                '@type': 'CustomChild',
                                '@id': '/custom#DROPPED_CUSTOM_CHILD_ID',
                                privateValue: 'PRIVATE_CUSTOM_CHILD_VALUE',
                                idOnlyNode: {
                                    '@id': 'DROPPED_ID_ONLY_NODE_ID',
                                    privateValue: 'PRIVATE_ID_ONLY_NODE_VALUE',
                                },
                            },
                        },
                    ],
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
            if (document.head) {
                appendInitialJsonLd()
            } else {
                document.onreadystatechange = () => {
                    if (document.head) {
                        document.onreadystatechange = null
                        appendInitialJsonLd()
                    }
                }
            }
        })
        await start(
            startOptions(
                {
                    maskAllInputs: true,
                    maskTextSelector: '.json-ld-mask',
                },
                true
            ),
            page,
            context
        )
        await waitForSessionRecordingToStart(page)

        await page.evaluate(() => {
            const script = document.createElement('script')
            script.type = 'application/ld+json'
            script.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'ALLOWED_DYNAMIC_PRODUCT',
                email: 'PRIVATE_DYNAMIC_EMAIL',
            })
            document.head.append(script)

            const maskedScript = document.createElement('script')
            maskedScript.type = 'application/ld+json'
            maskedScript.className = 'json-ld-mask'
            maskedScript.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'PRIVATE_DYNAMIC_MASKED_PRODUCT',
            })
            document.head.append(maskedScript)
        })
        await page.locator('[data-cy-input]').type('flush recording')

        const getEventBytes = async () =>
            JSON.stringify(
                (await page.capturedEvents())
                    .filter((event) => event.event === '$snapshot')
                    .flatMap((event) => event.properties['$snapshot_data'])
            )
        await expect.poll(getEventBytes).toContain('ALLOWED_DYNAMIC_PRODUCT')
        const eventBytes = await getEventBytes()
        const jsonLdEventBytes = JSON.stringify(
            (await page.capturedEvents())
                .filter((event) => event.event === '$snapshot')
                .flatMap((event) => event.properties['$snapshot_data'])
                .filter((event) => event.type === 5 && event.data.tag === '$json_ld')
        )
        expect(eventBytes).toContain('ALLOWED_PRODUCT_ID')
        expect(eventBytes).toContain('ALLOWED_INITIAL_PRODUCT')
        expect(eventBytes).toContain('ALLOWED_DYNAMIC_PRODUCT')
        expect(eventBytes).toContain('ALLOWED_MANUFACTURER')
        expect(eventBytes).toContain('ALLOWED_MANUFACTURER_LEGAL_NAME')
        expect(eventBytes).toContain('ALLOWED_GRAPH_LANGUAGE')
        expect(eventBytes).toContain('"@type":"PrivateType"')
        expect(eventBytes).toContain('ALLOWED_PRIVATE_GRAPH_ID')
        expect(eventBytes).not.toContain('"tagName":"script"')
        for (const privateMarker of [
            'PRIVATE_ATTRIBUTE',
            'PRIVATE_COMMENT',
            'PRIVATE_UNAPPROVED_EMAIL',
            'PRIVATE_DESCRIPTION',
            'PRIVATE_URL_TOKEN',
            'PRIVATE_PROPERTY_NAME@example.com',
            'ALLOWED_REDACTED_PROPERTY_DESCENDANT',
            'PRIVATE_ID_URL',
            'PRIVATE_MISSING_DOM_ID',
            'PRIVATE_NESTED_PERSON',
            'PRIVATE_MANUFACTURER_EMAIL',
            'PRIVATE_GRAPH_EMAIL',
            'PRIVATE_GRAPH_ENTITY',
            'PRIVATE_CUSTOM_CHILD_VALUE',
            'PRIVATE_ID_ONLY_NODE_VALUE',
            'PRIVATE_MASKED_PRODUCT',
            'PRIVATE_DYNAMIC_EMAIL',
            'PRIVATE_DYNAMIC_MASKED_PRODUCT',
        ]) {
            expect(eventBytes).not.toContain(privateMarker)
        }
        expect(jsonLdEventBytes).not.toContain('DROPPED_CUSTOM_CHILD_ID')
        expect(jsonLdEventBytes).not.toContain('DROPPED_ID_ONLY_NODE_ID')
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
