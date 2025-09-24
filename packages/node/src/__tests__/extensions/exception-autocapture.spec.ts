import ErrorTracking from '@/extensions/error-tracking'
import { PostHog } from '@/entrypoints/index.node'
import { addUncaughtExceptionListener, addUnhandledRejectionListener } from '@/extensions/error-tracking/autocapture'
import { Worker } from 'worker_threads'

describe('exception autocapture', () => {
  it('should capture uncaught exception', () => {
    global.process.on = jest.fn()
    addUncaughtExceptionListener(
      () => {},
      () => {}
    )
    expect(global.process.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function))
  })

  it('should capture unhandled rejection', () => {
    global.process.on = jest.fn()
    addUnhandledRejectionListener(() => {})
    expect(global.process.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function))
  })

  it('should listen to uncaught errors', async () => {
    const worker = new Worker(__dirname + '/exception-autocapture.worker.mjs')
    const capturePromise = new Promise<void>((res, rej) => {
      worker.on('message', (message) => {
        expect(message.method).toBe('capture')
        expect(message.event).toMatchSnapshot()
        res()
      })
    })
    worker.postMessage({ action: 'throw_error', data: 'Uncaught Error' })
    await capturePromise
  })

  it('should listen to unhandled rejections', async () => {
    const worker = new Worker(__dirname + '/exception-autocapture.worker.mjs')
    const capturePromise = new Promise<void>((res, rej) => {
      worker.on('message', (message) => {
        expect(message.method).toBe('capture')
        expect(message.event).toMatchSnapshot()
        res()
      })
    })
    worker.postMessage({ action: 'reject_promise', data: 'Unhandled Promise' })
    await capturePromise
  })

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
