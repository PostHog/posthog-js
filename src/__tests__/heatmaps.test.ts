import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHog } from '../posthog-core'
jest.mock('../utils/logger')

describe('heatmaps', () => {
    let posthog: PostHog
    let onCapture = jest.fn()

    const mockClickEvent = {
        target: document.body,
        clientX: 10,
        clientY: 20,
    } as unknown as MouseEvent

    const createMockMouseEvent = (props: Partial<MouseEvent> = {}) =>
        ({
            target: document.body,
            clientX: 10,
            clientY: 10,
            ...props,
        } as unknown as MouseEvent)

    beforeEach(async () => {
        onCapture = jest.fn()
        posthog = await createPosthogInstance(uuidv7(), { _onCapture: onCapture })
    })

    it('should include generated heatmap data', async () => {
        posthog.heatmaps?.['_onClick']?.(mockClickEvent as MouseEvent)
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
})
