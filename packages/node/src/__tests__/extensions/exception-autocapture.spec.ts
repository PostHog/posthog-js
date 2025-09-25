import ErrorTracking from '@/extensions/error-tracking'
import { PostHog } from '@/entrypoints/index.node'
import { addUncaughtExceptionListener, addUnhandledRejectionListener } from '@/extensions/error-tracking/autocapture'
import { Worker } from 'worker_threads'
import type { ErrorTracking as CoreErrorTracking } from '@posthog/core'

describe('exception autocapture', () => {
  function checkException(
    exception: CoreErrorTracking.Exception,
    {
      exceptionType,
      exceptionMessage,
      mechanism,
      framesLength,
      lastFrameFileName,
      lastFrameHasContext,
    }: {
      exceptionType: string
      exceptionMessage: string
      mechanism: CoreErrorTracking.Mechanism
      framesLength: number
      lastFrameFileName: string
      lastFrameHasContext: boolean
    }
  ) {
    expect(exception.type).toBe(exceptionType)
    expect(exception.value).toBe(exceptionMessage)
    const frames = exception.stacktrace!.frames!
    const frameLength = frames.length
    expect(frameLength).toBe(framesLength)
    const lastFrame = frames[frameLength - 1]
    expect(exception.mechanism).toMatchObject(mechanism)
    expect(lastFrame.filename).toBe(lastFrameFileName)
    if (lastFrameHasContext) {
      expect(lastFrame.context_line).toBeDefined()
      expect(lastFrame.post_context).toBeDefined()
      expect(lastFrame.pre_context).toBeDefined()
    }
  }

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
    const workerFilename = __dirname + '/exception-autocapture.worker.mjs'
    const worker = new Worker(workerFilename)
    const exceptionMessage = 'Uncaught Error'
    const capturePromise = new Promise<void>((res, rej) => {
      worker.on('message', (message) => {
        expect(message.method).toBe('capture')
        const firstException = message.event.properties.$exception_list[0]
        checkException(firstException, {
          exceptionType: 'Error',
          exceptionMessage,
          mechanism: {
            handled: false,
            type: 'onuncaughtexception',
          },
          framesLength: 3,
          lastFrameFileName: workerFilename,
          lastFrameHasContext: true,
        })
        res()
      })
    })
    worker.postMessage({ action: 'throw_error', data: exceptionMessage })
    await capturePromise
  })

  it('should listen to unhandled rejections', async () => {
    const exceptionMessage = 'Unhandled Promise'
    const workerFilename = __dirname + '/exception-autocapture.worker.mjs'
    const worker = new Worker(workerFilename)
    const capturePromise = new Promise<void>((res, rej) => {
      worker.on('message', (message) => {
        expect(message.method).toBe('capture')
        const firstException = message.event.properties.$exception_list[0]
        checkException(firstException, {
          exceptionType: 'Error',
          exceptionMessage,
          mechanism: {
            handled: false,
            type: 'onunhandledrejection',
          },
          framesLength: 1,
          lastFrameFileName: workerFilename,
          lastFrameHasContext: true,
        })
        res()
        // Suppress jest warning on crashed worker
        worker.unref()
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
