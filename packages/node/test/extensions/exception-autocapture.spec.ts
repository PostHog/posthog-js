import ErrorTracking from '../../src/extensions/error-tracking'
import { PostHog } from '../../src/entrypoints/index.node'

describe('exception autocapture', () => {
  it('should rate limit when more than 10 of the same exception are caught', async () => {
    jest.spyOn(ErrorTracking, 'buildEventMessage').mockResolvedValue({
      event: '$exception',
      distinctId: 'distinct-id',
      properties: { $exception_list: [{ type: 'Error' }] },
    })

    const ph = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      fetchRetryCount: 0,
      disableCompression: true,
    })

    const mockedCapture = jest.spyOn(ph, 'capture').mockImplementation()

    const captureExceptions = Array.from({ length: 20 }).map(() => ph['errorTracking']['onException']({}, {}))
    await Promise.all(captureExceptions)

    // captures until rate limited
    expect(mockedCapture).toHaveBeenCalledTimes(9)
  })
})
