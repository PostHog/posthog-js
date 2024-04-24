import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHog } from '../posthog-core'
import { HEATMAPS_ENABLED_SERVER_SIDE } from '../constants'
import { DecideResponse } from '../types'
jest.mock('../utils/logger')

describe('heatmaps', () => {
    let posthog: PostHog
    let onCapture = jest.fn()

    const createMockMouseEvent = (props: Partial<MouseEvent> = {}) =>
        ({
            target: document.body,
            clientX: 10,
            clientY: 20,
            ...props,
        } as unknown as MouseEvent)

    beforeEach(async () => {
        onCapture = jest.fn()
        posthog = await createPosthogInstance(uuidv7(), { _onCapture: onCapture })
    })

    it('should include generated heatmap data', async () => {
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())
        posthog.capture('test event')

        expect(onCapture).toBeCalledTimes(1)
        expect(onCapture.mock.lastCall).toMatchObject([
            'test event',
            {
                event: 'test event',
                properties: {
                    $heatmap_data: {
                        'http://localhost/': [
                            {
                                target_fixed: false,
                                type: 'click',
                                x: 10,
                                y: 20,
                            },
                        ],
                    },
                },
            },
        ])
    })

    it('should add rageclick events in the same area', async () => {
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())

        posthog.capture('test event')

        expect(onCapture).toBeCalledTimes(1)
        expect(onCapture.mock.lastCall[1].properties.$heatmap_data['http://localhost/']).toHaveLength(4)
        expect(onCapture.mock.lastCall[1].properties.$heatmap_data['http://localhost/'].map((x) => x.type)).toEqual([
            'click',
            'click',
            'rageclick',
            'click',
        ])
    })

    it('should clear the buffer after each call', async () => {
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())
        posthog.capture('test event')
        expect(onCapture).toBeCalledTimes(1)
        expect(onCapture.mock.lastCall[1].properties.$heatmap_data['http://localhost/']).toHaveLength(2)

        posthog.capture('test event 2')
        expect(onCapture).toBeCalledTimes(2)
        expect(onCapture.mock.lastCall[1].properties.$heatmap_data).toBeUndefined()
    })

    it('should not include generated heatmap data for $snapshot events with _noHeatmaps', async () => {
        posthog.heatmaps?.['_onClick']?.(createMockMouseEvent())
        posthog.capture('$snapshot', undefined, { _noHeatmaps: true })

        expect(onCapture).toBeCalledTimes(1)
        expect(onCapture.mock.lastCall).toMatchObject(['$snapshot', {}])
        expect(onCapture.mock.lastCall[1].properties).not.toHaveProperty('$heatmap_data')
    })

    it('should ignore clicks if they come from the toolbar', async () => {
        posthog.heatmaps?.['_onClick']?.(
            createMockMouseEvent({
                target: { id: '__POSTHOG_TOOLBAR__' } as Element,
            })
        )
        expect(posthog.heatmaps?.['buffer']).toEqual(undefined)

        posthog.heatmaps?.['_onClick']?.(
            createMockMouseEvent({
                target: { closest: () => ({}) } as unknown as Element,
            })
        )
        expect(posthog.heatmaps?.['buffer']).toEqual(undefined)

        posthog.heatmaps?.['_onClick']?.(
            createMockMouseEvent({
                target: document.body,
            })
        )
        expect(posthog.heatmaps?.['buffer']).not.toEqual(undefined)
    })

    describe('afterDecideResponse()', () => {
        it('should not be enabled before the decide response', () => {
            expect(posthog.heatmaps!.isEnabled).toBe(false)
        })

        it('should be enabled if client config option is enabled', () => {
            posthog.config.__preview_heatmaps = true
            expect(posthog.heatmaps!.isEnabled).toBe(true)
        })

        it.each([
            // Client not defined
            [undefined, false, false],
            [undefined, true, true],
            [undefined, false, false],
            // Client false
            [false, false, false],
            [false, true, false],

            // Client true
            [true, false, true],
            [true, true, true],
        ])(
            'when client side config is %p and remote opt in is %p - heatmaps enabled should be %p',
            (clientSideOptIn, serverSideOptIn, expected) => {
                posthog.config.__preview_heatmaps = clientSideOptIn
                posthog.heatmaps!.afterDecideResponse({
                    heatmaps: serverSideOptIn,
                } as DecideResponse)
                expect(posthog.heatmaps!.isEnabled).toBe(expected)
            }
        )
    })
})
