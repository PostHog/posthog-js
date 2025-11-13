import { defaultPostHog } from './helpers/posthog-instance'
import type { PostHogConfig } from '../types'
import { uuidv7 } from '../uuidv7'

describe('ai', () => {
    beforeEach(() => {
        console.error = jest.fn()
    })

    const setup = async (config: Partial<PostHogConfig> = {}, token: string = uuidv7()) => {
        const beforeSendMock = jest.fn().mockImplementation((e) => e)
        return await new Promise<{ posthog: any; beforeSendMock: jest.Mock }>((resolve) => {
            const posthog = defaultPostHog().init(
                token,
                {
                    ...config,
                    before_send: beforeSendMock,
                    loaded: (ph) => {
                        ph.debug()
                        config.loaded?.(ph)
                        resolve({ posthog: ph, beforeSendMock })
                    },
                },
                token
            )!
        })
    }

    describe('captureTraceMetric()', () => {
        it('should capture metric', async () => {
            const { posthog, beforeSendMock } = await setup()

            posthog.captureTraceMetric('123', 'test', 'test')

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe('$ai_metric')
            expect(properties['$ai_trace_id']).toBe('123')
            expect(properties['$ai_metric_name']).toBe('test')
            expect(properties['$ai_metric_value']).toBe('test')
        })

        it('should convert numeric values', async () => {
            const { posthog, beforeSendMock } = await setup()

            posthog.captureTraceMetric(123, 'test', 1)

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe('$ai_metric')
            expect(properties['$ai_trace_id']).toBe('123')
            expect(properties['$ai_metric_name']).toBe('test')
            expect(properties['$ai_metric_value']).toBe('1')
        })

        it('should convert boolean metric_value', async () => {
            const { posthog, beforeSendMock } = await setup()

            posthog.captureTraceMetric('test', 'test', false)

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe('$ai_metric')
            expect(properties['$ai_trace_id']).toBe('test')
            expect(properties['$ai_metric_name']).toBe('test')
            expect(properties['$ai_metric_value']).toBe('false')
        })
    })

    describe('captureTraceFeedback()', () => {
        it('should capture feedback', async () => {
            const { posthog, beforeSendMock } = await setup()

            posthog.captureTraceFeedback('123', 'feedback')

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe('$ai_feedback')
            expect(properties['$ai_trace_id']).toBe('123')
            expect(properties['$ai_feedback_text']).toBe('feedback')
        })

        it('should convert numeric values', async () => {
            const { posthog, beforeSendMock } = await setup()

            posthog.captureTraceFeedback(123, 'feedback')

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe('$ai_feedback')
            expect(properties['$ai_trace_id']).toBe('123')
            expect(properties['$ai_feedback_text']).toBe('feedback')
        })
    })
})
