import './helpers/mock-logger'

import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHog } from '../posthog-core'
import { FlagsResponse } from '../types'
import { isObject } from '@posthog/core'
import { beforeEach, expect } from '@jest/globals'
import { HEATMAPS_ENABLED_SERVER_SIDE } from '../constants'
import { Heatmaps } from '../heatmaps'
import { DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS } from '../autocapture-utils'

jest.useFakeTimers()

describe('heatmaps', () => {
    let posthog: PostHog
    let beforeSendMock = jest.fn().mockImplementation((e) => e)

    const createMockMouseEvent = (props: Partial<MouseEvent> = {}) =>
        ({
            target: document.body,
            clientX: 10,
            clientY: 20,
            ...props,
        }) as unknown as MouseEvent

    beforeEach(async () => {
        beforeSendMock = beforeSendMock.mockClear()

        posthog = await createPosthogInstance(uuidv7(), {
            beforeSend: [
                (cr) => {
                    if (!cr) {
                        return cr
                    }
                    // what ever sanitization makes sense
                    const sanitizeUrl = (url: string) => url.replace(/https?:\/\/[^/]+/g, 'http://replaced')
                    const props = cr.properties
                    if (props['$current_url']) {
                        props['$current_url'] = sanitizeUrl(props['$current_url'])
                    }
                    if (isObject(props['$heatmap_data'])) {
                        // the keys of the heatmap data are URLs, so we might need to sanitize them to
                        // this sanitized URL would need to be entered in the toolbar for the heatmap display to work
                        props['$heatmap_data'] = Object.entries(props['$heatmap_data']).reduce((acc, [url, data]) => {
                            acc[sanitizeUrl(url)] = data
                            return acc
                        }, {})
                    }
                    return cr
                },
                beforeSendMock,
            ],
            // simplifies assertions by not needing to ignore events
            capturePageview: false,
        })

        posthog.config.captureHeatmaps = true

        // make sure we start fresh
        posthog.heatmaps!.startIfEnabled()
        expect(posthog.heatmaps!.getAndClearBuffer()).toBeUndefined()

        posthog.register({ $current_test_name: expect.getState().currentTestName })
    })

    it('should send generated heatmap data', async () => {
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())

        jest.advanceTimersByTime(posthog.heatmaps!.flushIntervalMilliseconds + 1)

        expect(beforeSendMock).toBeCalledTimes(1)
        expect(beforeSendMock.mock.lastCall[0]).toMatchObject({
            event: '$$heatmap',
            properties: {
                $heatmap_data: {
                    'http://replaced/': [
                        {
                            target_fixed: false,
                            type: 'click',
                            x: 10,
                            y: 20,
                        },
                    ],
                },
            },
        })
    })

    it('should flush on window unload', async () => {
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())

        window.dispatchEvent(new Event('beforeunload'))

        expect(beforeSendMock).toBeCalledTimes(1)
        expect(beforeSendMock.mock.lastCall[0]).toMatchObject({
            event: '$$heatmap',
            properties: {
                $heatmap_data: {
                    'http://replaced/': [
                        {
                            target_fixed: false,
                            type: 'click',
                            x: 10,
                            y: 20,
                        },
                    ],
                },
            },
        })
    })

    it('requires interval to pass before sending data', async () => {
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())

        jest.advanceTimersByTime(posthog.heatmaps!.flushIntervalMilliseconds - 1)

        expect(beforeSendMock).toBeCalledTimes(0)
        expect(posthog.heatmaps!.getAndClearBuffer()).toBeDefined()
    })

    it('should handle empty mouse moves', async () => {
        posthog.heatmaps?.['_onMouseMove']?.(new Event('mousemove'))

        jest.advanceTimersByTime(posthog.heatmaps!.flushIntervalMilliseconds + 1)

        expect(beforeSendMock).toBeCalledTimes(0)
    })

    it('should send rageclick events in the same area', async () => {
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())

        jest.advanceTimersByTime(posthog.heatmaps!.flushIntervalMilliseconds + 1)

        expect(beforeSendMock).toBeCalledTimes(1)
        expect(beforeSendMock.mock.lastCall[0].event).toEqual('$$heatmap')
        const heatmapData = beforeSendMock.mock.lastCall[0].properties.$heatmap_data
        expect(heatmapData).toBeDefined()
        expect(heatmapData['http://replaced/']).toHaveLength(4)
        expect(heatmapData['http://replaced/'].map((x) => x.type)).toEqual(['click', 'click', 'rageclick', 'click'])
    })

    it('should downgrade rageclick to click for suppressed targets', async () => {
        posthog.config.rageclick = { content_ignorelist: DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS }

        const stepperButton = document.createElement('button')
        stepperButton.textContent = '+'

        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent({ target: stepperButton }))
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent({ target: stepperButton }))
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent({ target: stepperButton }))

        jest.advanceTimersByTime(posthog.heatmaps!.flushIntervalMilliseconds + 1)

        expect(beforeSendMock).toBeCalledTimes(1)
        const heatmapData = beforeSendMock.mock.lastCall[0].properties.$heatmap_data
        expect(heatmapData).toBeDefined()
        expect(heatmapData['http://replaced/']).toHaveLength(3)
        expect(heatmapData['http://replaced/'].map((x: { type: string }) => x.type)).toEqual([
            'click',
            'click',
            'click',
        ])
    })

    it('should clear the buffer after each call', async () => {
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())

        jest.advanceTimersByTime(posthog.heatmaps!.flushIntervalMilliseconds + 1)

        expect(beforeSendMock).toBeCalledTimes(1)
        expect(beforeSendMock.mock.lastCall[0].event).toEqual('$$heatmap')
        expect(beforeSendMock.mock.lastCall[0].properties.$heatmap_data).toBeDefined()
        expect(beforeSendMock.mock.lastCall[0].properties.$heatmap_data['http://replaced/']).toHaveLength(2)

        expect(posthog.heatmaps!['buffer']).toEqual(undefined)

        jest.advanceTimersByTime(posthog.heatmaps!.flushIntervalMilliseconds + 1)

        expect(beforeSendMock).toBeCalledTimes(1)
    })

    it('should ignore clicks if they come from the toolbar', async () => {
        const testElementToolbar = document.createElement('div')
        testElementToolbar.id = '__POSTHOG_TOOLBAR__'

        posthog.heatmaps?.['_onClick']?.(
            createMockMouseEvent({
                target: testElementToolbar,
            })
        )
        expect(posthog.heatmaps?.['buffer']).toEqual(undefined)

        const testElementClosest = document.createElement('div')
        testElementClosest.closest = () => {
            return {}
        }

        posthog.heatmaps?.['_onClick']?.(
            createMockMouseEvent({
                target: testElementClosest,
            })
        )
        expect(posthog.heatmaps?.['buffer']).toEqual(undefined)

        posthog.heatmaps?.['_onClick']?.(
            createMockMouseEvent({
                target: document.body,
            })
        )
        expect(posthog.heatmaps?.getAndClearBuffer()).not.toEqual(undefined)
        expect(beforeSendMock.mock.calls).toEqual([])
    })

    it('should ignore an empty buffer', async () => {
        expect(beforeSendMock.mock.calls).toEqual([])

        expect(posthog.heatmaps?.['buffer']).toEqual(undefined)

        jest.advanceTimersByTime(posthog.heatmaps!.flushIntervalMilliseconds + 1)

        expect(beforeSendMock.mock.calls).toEqual([])
    })

    describe('onRemoteConfig', () => {
        it('does not overwrite persistence when called with empty config', () => {
            // Set up existing persisted value
            posthog.persistence!.register({ [HEATMAPS_ENABLED_SERVER_SIDE]: true })
            const heatmaps = new Heatmaps(posthog)

            // Call with empty config (simulating config fetch failure)
            heatmaps.onRemoteConfig({} as FlagsResponse)

            // Should NOT have overwritten the existing value
            expect(posthog.persistence!.props[HEATMAPS_ENABLED_SERVER_SIDE]).toBe(true)
        })

        it('updates persistence when heatmaps key is present', () => {
            posthog.persistence!.register({ [HEATMAPS_ENABLED_SERVER_SIDE]: true })
            const heatmaps = new Heatmaps(posthog)

            heatmaps.onRemoteConfig({ heatmaps: false } as FlagsResponse)

            expect(posthog.persistence!.props[HEATMAPS_ENABLED_SERVER_SIDE]).toBe(false)
        })
    })

    describe('isEnabled()', () => {
        it.each([
            [undefined, false],
            [null, false],
            [true, true],
            [false, false],
        ])('when stored remote config is %p - heatmaps enabled should be %p', (stored, expected) => {
            posthog.persistence!.register({ [HEATMAPS_ENABLED_SERVER_SIDE]: stored })
            posthog.config.captureHeatmaps = undefined
            const heatmaps = new Heatmaps(posthog)
            expect(heatmaps.isEnabled).toBe(expected)
        })

        it.each([
            [undefined, false],
            [null, false],
            [true, true],
            [false, false],
        ])('when local config is %p - heatmaps enabled should be %p', (localConfig, expected) => {
            posthog.persistence!.register({ [HEATMAPS_ENABLED_SERVER_SIDE]: undefined })
            posthog.config.captureHeatmaps = localConfig
            const heatmaps = new Heatmaps(posthog)
            expect(heatmaps.isEnabled).toBe(expected)
        })

        it.each([
            // client side config not defined - remote decides
            [undefined, false, false],
            [undefined, true, true],
            // null config values should fall through like undefined
            [null, false, false],
            [null, true, true],
            // client side config overrides remote
            [false, false, false],
            [false, true, false],
            [true, false, true],
            [true, true, true],
        ])(
            'when client side config is %p and remote opt in is %p - heatmaps enabled should be %p',
            (clientSideOptIn, serverSideOptIn, expected) => {
                posthog.config.captureHeatmaps = clientSideOptIn
                posthog.heatmaps!.onRemoteConfig({
                    heatmaps: serverSideOptIn,
                } as FlagsResponse)
                expect(posthog.heatmaps!.isEnabled).toBe(expected)
            }
        )
    })

    it('starts dead clicks autocapture with the correct config', () => {
        const heatmapsDeadClicksInstance = posthog.heatmaps['_deadClicksCapture']
        expect(heatmapsDeadClicksInstance.isEnabled(heatmapsDeadClicksInstance)).toBe(true)
        // this is a little nasty but the binding to this makes the function not directly comparable
        expect(JSON.stringify(heatmapsDeadClicksInstance.onCapture)).toEqual(
            JSON.stringify(posthog.heatmaps['_onDeadClick'].bind(posthog.heatmaps))
        )
    })

    describe.each([
        [false, undefined, 'http://localhost/?gclid=12345&other=true'],
        [true, undefined, 'http://localhost/?gclid=<masked>&other=true'],
        [true, ['other'], 'http://localhost/?gclid=<masked>&other=<masked>'],
    ])(
        'the behaviour when maskPersonalDataProperties is %s and customPersonalDataProperties is %s',
        (
            maskPersonalDataProperties: boolean,
            customPersonalDataProperties: undefined | string[],
            maskedUrl: string
        ) => {
            beforeEach(async () => {
                beforeSendMock = beforeSendMock.mockClear()

                const posthogWithMasking = await createPosthogInstance(uuidv7(), {
                    beforeSend: beforeSendMock,
                    maskPersonalDataProperties: maskPersonalDataProperties,
                    customPersonalDataProperties: customPersonalDataProperties,
                })

                Object.defineProperty(window, 'location', {
                    value: {
                        href: 'http://localhost/?gclid=12345&other=true',
                    },
                    writable: true,
                })

                posthogWithMasking.config.captureHeatmaps = true
                posthogWithMasking.heatmaps!.startIfEnabled()
                posthogWithMasking.heatmaps?.['_onClick']?.(createMockMouseEvent())

                jest.advanceTimersByTime(posthogWithMasking.heatmaps!.flushIntervalMilliseconds + 1)
            })

            it('masks properties accordingly', async () => {
                const heatmapData = beforeSendMock.mock.lastCall[0].properties.$heatmap_data
                expect(heatmapData).toMatchObject({ [maskedUrl]: {} })
            })
        }
    )
})
