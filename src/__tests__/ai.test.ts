import { defaultPostHog } from './helpers/posthog-instance'
import type { PostHogConfig } from '../types'
import { uuidv7 } from '../uuidv7'
import { AI_FEEDBACK_EVENT, AI_METRIC_EVENT } from '../events'

describe('ai', () => {
    beforeEach(() => {
        console.error = jest.fn()
    })

    const setup = (config: Partial<PostHogConfig> = {}, token: string = uuidv7()) => {
        const beforeSendMock = jest.fn().mockImplementation((e) => e)
        const posthog = defaultPostHog().init(token, { ...config, before_send: beforeSendMock }, token)!
        posthog.debug()
        return { posthog, beforeSendMock }
    }

    describe('captureTraceMetric()', () => {
        it('should capture metric', () => {
            const { posthog, beforeSendMock } = setup()

            posthog.captureTraceMetric('123', 'test', 'test')

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe(AI_METRIC_EVENT)
            expect(properties['$ai_trace_id']).toBe('123')
            expect(properties['$ai_metric_name']).toBe('test')
            expect(properties['$ai_metric_value']).toBe('test')
        })

        it('should convert numeric values', () => {
            const { posthog, beforeSendMock } = setup()

            posthog.captureTraceMetric(123, 'test', 1)

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe(AI_METRIC_EVENT)
            expect(properties['$ai_trace_id']).toBe('123')
            expect(properties['$ai_metric_name']).toBe('test')
            expect(properties['$ai_metric_value']).toBe('1')
        })

        it('should convert boolean metric_value', () => {
            const { posthog, beforeSendMock } = setup()

            posthog.captureTraceMetric('test', 'test', false)

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe(AI_METRIC_EVENT)
            expect(properties['$ai_trace_id']).toBe('test')
            expect(properties['$ai_metric_name']).toBe('test')
            expect(properties['$ai_metric_value']).toBe('false')
        })
    })

    describe('captureTraceFeedback()', () => {
        it('should capture feedback', () => {
            const { posthog, beforeSendMock } = setup()

            posthog.captureTraceFeedback('123', 'feedback')

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe(AI_FEEDBACK_EVENT)
            expect(properties['$ai_trace_id']).toBe('123')
            expect(properties['$ai_feedback_text']).toBe('feedback')
        })

        it('should convert numeric values', () => {
            const { posthog, beforeSendMock } = setup()

            posthog.captureTraceFeedback(123, 'feedback')

            const { event, properties } = beforeSendMock.mock.calls[0][0]
            expect(event).toBe(AI_FEEDBACK_EVENT)
            expect(properties['$ai_trace_id']).toBe('123')
            expect(properties['$ai_feedback_text']).toBe('feedback')
        })
    })
})
