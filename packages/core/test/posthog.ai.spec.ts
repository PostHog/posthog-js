import { parseBody, waitForPromises } from './test-utils/test-utils'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from './test-utils/PostHogCoreTestClient'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 })
  })

  describe('ai', () => {
    it('should capture feedback', async () => {
      jest.setSystemTime(new Date('2022-01-01'))

      posthog.captureTraceFeedback('trace-id', 'feedback')

      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body).toMatchObject({
        batch: [
          {
            event: '$ai_feedback',
            properties: {
              $ai_feedback_text: 'feedback',
              $ai_trace_id: 'trace-id',
            },
          },
        ],
      })
    })

    it('should convert numeric traceId in captureTraceFeedback', async () => {
      jest.setSystemTime(new Date('2022-01-01'))

      posthog.captureTraceFeedback(10, 'feedback')

      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body).toMatchObject({
        batch: [
          {
            event: '$ai_feedback',
            properties: {
              $ai_feedback_text: 'feedback',
              $ai_trace_id: '10',
            },
          },
        ],
      })
    })

    it('should capture a metric', async () => {
      jest.setSystemTime(new Date('2022-01-01'))

      posthog.captureTraceMetric('trace-id', 'metric-name', 'good')

      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body).toMatchObject({
        batch: [
          {
            event: '$ai_metric',
            properties: {
              $ai_metric_name: 'metric-name',
              $ai_metric_value: 'good',
              $ai_trace_id: 'trace-id',
            },
          },
        ],
      })
    })

    it('should convert numeric arguments in captureTraceMetric', async () => {
      jest.setSystemTime(new Date('2022-01-01'))

      posthog.captureTraceMetric(10, 'metric-name', 1)

      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body).toMatchObject({
        batch: [
          {
            event: '$ai_metric',
            properties: {
              $ai_metric_name: 'metric-name',
              $ai_metric_value: '1',
              $ai_trace_id: '10',
            },
          },
        ],
      })
    })
  })
})
