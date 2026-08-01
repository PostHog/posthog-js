import ErrorTracking from '@/extensions/error-tracking'
import { PostHog } from '@/entrypoints/index.node'
import {
  addUncaughtExceptionListener,
  addUnhandledRejectionListener,
  getUnhandledRejectionMode,
} from '@/extensions/error-tracking/autocapture'
import { Worker } from 'worker_threads'
import { relative } from 'path'
import { once } from 'events'
import { spawn } from 'child_process'
import type { ErrorTracking as CoreErrorTracking } from '@posthog/core'

type ChildResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

type ChildScenario = 'no-application-listener' | 'unhandled-rejection-listener' | 'uncaught-exception-listener'

function runUnhandledRejectionChild({
  mode,
  scenario = 'no-application-listener',
  withSdk = true,
  useNodeOptions = false,
}: {
  mode?: 'throw' | 'strict' | 'warn' | 'warn-with-error-code' | 'none'
  scenario?: ChildScenario
  withSdk?: boolean
  useNodeOptions?: boolean
}): Promise<ChildResult> {
  const childFilename = __dirname + '/exception-autocapture.child.cjs'
  const modeArgument = mode ? `--unhandled-rejections=${mode}` : undefined
  const execArgs = [
    ...(!useNodeOptions && modeArgument ? [modeArgument] : []),
    childFilename,
    scenario,
    withSdk ? 'with-sdk' : 'without-sdk',
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, execArgs, {
      env: {
        ...process.env,
        NODE_OPTIONS: useNodeOptions ? modeArgument : undefined,
      },
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

function captureCount(result: ChildResult): number {
  return result.stdout.match(/^posthog-capture:/gm)?.length ?? 0
}

describe('exception autocapture', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })
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

  it('should install an uncaught-exception listener', () => {
    const onSpy = jest.spyOn(global.process, 'on').mockReturnValue(global.process)

    addUncaughtExceptionListener(
      () => {},
      () => {}
    )

    expect(onSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function))
  })

  it.each(['throw', 'strict', 'warn-with-error-code'] as const)(
    'should not install an unhandled-rejection listener in %s mode',
    (mode) => {
      const onSpy = jest.spyOn(global.process, 'on').mockReturnValue(global.process)

      addUnhandledRejectionListener(() => {}, mode)

      expect(onSpy).not.toHaveBeenCalled()
    }
  )

  it.each(['warn', 'none'] as const)('should install an unhandled-rejection listener in %s mode', (mode) => {
    const onSpy = jest.spyOn(global.process, 'on').mockReturnValue(global.process)

    addUnhandledRejectionListener(() => {}, mode)

    expect(onSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function))
  })

  it('should determine the effective unhandled rejection mode from execArgv and NODE_OPTIONS', () => {
    expect(getUnhandledRejectionMode([], undefined)).toBe('throw')
    expect(getUnhandledRejectionMode([], '--unhandled-rejections warn')).toBe('warn')
    expect(
      getUnhandledRejectionMode(
        [],
        '--require="./path with --unhandled-rejections=none.js" --unhandled_rejections=none'
      )
    ).toBe('none')
    expect(getUnhandledRejectionMode([], '--require=module\t--unhandled-rejections=warn')).toBe('throw')
    expect(getUnhandledRejectionMode([], "--require='./path with --unhandled-rejections=none.js'")).toBe('throw')
    expect(
      getUnhandledRejectionMode(
        ['--unhandled-rejections=strict', '--unhandled-rejections', 'throw'],
        '--unhandled-rejections=warn'
      )
    ).toBe('throw')
  })

  it('should tag promoted unhandled rejections from the Node uncaught-exception origin', () => {
    const capture = jest.fn()
    const onSpy = jest.spyOn(global.process, 'on').mockReturnValue(global.process)
    addUncaughtExceptionListener(capture, () => {})
    const handler = onSpy.mock.calls.find(([event]) => event === 'uncaughtException')?.[1] as
      | NodeJS.UncaughtExceptionListener
      | undefined
    const reason = new Error('promoted rejection')

    handler?.(reason, 'unhandledRejection')

    expect(capture).toHaveBeenCalledWith(reason, {
      mechanism: {
        type: 'onunhandledrejection',
        handled: false,
      },
    })
  })

  it('should listen to uncaught errors', async () => {
    const workerFilename = __dirname + '/exception-autocapture.worker.mjs'
    const worker = new Worker(workerFilename)
    const exceptionMessage = 'Uncaught Error'
    try {
      worker.postMessage({ action: 'throw_error', data: exceptionMessage })
      const [message] = await once(worker, 'message')
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
        lastFrameFileName: relative(process.cwd(), workerFilename),
        lastFrameHasContext: true,
      })
    } finally {
      await worker.terminate()
    }
  })

  it('should listen to unhandled rejections', async () => {
    const exceptionMessage = 'Unhandled Promise'
    const workerFilename = __dirname + '/exception-autocapture.worker.mjs'
    const worker = new Worker(workerFilename)
    try {
      const exitPromise = once(worker, 'exit')
      worker.postMessage({ action: 'reject_promise', data: exceptionMessage })
      const [message] = await once(worker, 'message')
      const [exitCode] = await exitPromise
      expect(exitCode).toBe(1)
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
        lastFrameFileName: relative(process.cwd(), workerFilename),
        lastFrameHasContext: true,
      })
    } finally {
      if (worker.threadId !== -1) {
        await worker.terminate()
      }
    }
  })

  it.each([
    ['default', undefined],
    ['throw', 'throw' as const],
    ['strict', 'strict' as const],
  ])('should capture a fatal rejection once in %s mode', async (_name, mode) => {
    const [withoutSdk, withSdk] = await Promise.all([
      runUnhandledRejectionChild({ mode, withSdk: false }),
      runUnhandledRejectionChild({ mode }),
    ])

    for (const result of [withoutSdk, withSdk]) {
      expect(result.signal).toBeNull()
      expect(result.code).toBe(1)
      expect(result.stdout).not.toContain('completed')
      expect(result.stderr).toContain('Child process rejection')
    }
    expect(captureCount(withoutSdk)).toBe(0)
    expect(captureCount(withSdk)).toBe(1)
    expect(withSdk.stdout).toContain('posthog-capture:onunhandledrejection:Child process rejection')
  })

  it('should preserve application uncaught-exception handling', async () => {
    const [withoutSdk, withSdk] = await Promise.all([
      runUnhandledRejectionChild({
        mode: 'throw',
        scenario: 'uncaught-exception-listener',
        withSdk: false,
      }),
      runUnhandledRejectionChild({ mode: 'throw', scenario: 'uncaught-exception-listener' }),
    ])

    for (const result of [withoutSdk, withSdk]) {
      expect(result.signal).toBeNull()
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('uncaught-listener:unhandledRejection:Child process rejection')
      expect(result.stdout).toContain('completed')
    }
    expect(captureCount(withoutSdk)).toBe(0)
    expect(captureCount(withSdk)).toBe(1)
  })

  it('should preserve warn mode without forcing the child process to exit', async () => {
    const result = await runUnhandledRejectionChild({ mode: 'warn', useNodeOptions: true })

    expect(result.signal).toBeNull()
    expect(result.code).toBe(0)
    expect(captureCount(result)).toBe(1)
    expect(result.stdout).toContain('completed')
    expect(result.stderr).toContain('UnhandledPromiseRejectionWarning')
  })

  it('should preserve none mode without forcing the child process to exit', async () => {
    const result = await runUnhandledRejectionChild({ mode: 'none', useNodeOptions: true })

    expect(result.signal).toBeNull()
    expect(result.code).toBe(0)
    expect(captureCount(result)).toBe(1)
    expect(result.stdout).toContain('completed')
    expect(result.stderr).toBe('')
  })

  it('should preserve warn-with-error-code mode without capturing the rejection', async () => {
    const [withoutSdk, withSdk] = await Promise.all([
      runUnhandledRejectionChild({ mode: 'warn-with-error-code', withSdk: false }),
      runUnhandledRejectionChild({ mode: 'warn-with-error-code' }),
    ])

    for (const result of [withoutSdk, withSdk]) {
      expect(result.signal).toBeNull()
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('completed')
      expect(result.stderr).toContain('UnhandledPromiseRejectionWarning')
    }
    expect(captureCount(withoutSdk)).toBe(0)
    expect(captureCount(withSdk)).toBe(0)
  })

  it('should leave application unhandled-rejection handling untouched in throw mode', async () => {
    const result = await runUnhandledRejectionChild({ mode: 'throw', scenario: 'unhandled-rejection-listener' })

    expect(result.signal).toBeNull()
    expect(result.code).toBe(0)
    expect(captureCount(result)).toBe(0)
    expect(result.stdout).toContain('unhandled-listener:Child process rejection')
    expect(result.stdout).toContain('completed')
    expect(result.stderr).toBe('')
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

    try {
      const mockedCapture = jest.spyOn(ph, '_capturePreparedEvent').mockResolvedValue(undefined)

      const captureExceptions = Array.from({ length: 20 }).map(() => ph['errorTracking']['onException']({}, {}))
      await Promise.all(captureExceptions)

      // captures until rate limited
      expect(mockedCapture).toHaveBeenCalledTimes(9)
    } finally {
      await ph.shutdown()
    }
  })

  it('should honour the configured rate limiter bucket size', async () => {
    jest.spyOn(ErrorTracking, 'buildEventMessage').mockResolvedValue({
      event: '$exception',
      distinctId: 'distinct-id',
      properties: { $exception_list: [{ type: 'Error' }] },
    })

    const ph = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      fetchRetryCount: 0,
      disableCompression: true,
      exceptionRateLimiterBucketSize: 3,
    })

    try {
      const mockedCapture = jest.spyOn(ph, '_capturePreparedEvent').mockResolvedValue(undefined)

      const captureExceptions = Array.from({ length: 20 }).map(() => ph['errorTracking']['onException']({}, {}))
      await Promise.all(captureExceptions)

      // captures until rate limited (bucket of 3 leaves 2 through before the limiter kicks in)
      expect(mockedCapture).toHaveBeenCalledTimes(2)
    } finally {
      await ph.shutdown()
    }
  })
})
