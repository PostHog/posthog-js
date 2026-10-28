import ErrorTracking from '@/extensions/error-tracking'
import { PostHog } from '@/entrypoints/index.node'
import {
  addExceptionAutocaptureListeners,
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

type ChildScenario =
  | 'no-application-listener'
  | 'unhandled-rejection-listener'
  | 'late-unhandled-rejection-listener'
  | 'removed-unhandled-rejection-listener'
  | 'rethrowing-unhandled-rejection-listener'
  | 'late-rethrowing-unhandled-rejection-listener'
  | 'uncaught-exception-listener'
  | 'mutated-node-options'
  | 'mutated-exec-argv'

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

type Listener = (...args: any[]) => unknown

// Replaces the process listener registry, so tests can add host listeners and emit events without touching the runner.
function stubProcessListeners(hostRejectionListeners: Listener[] = []) {
  const registry = new Map<string | symbol, Listener[]>([['unhandledRejection', [...hostRejectionListeners]]])
  const get = (event: string | symbol): Listener[] => registry.get(event) ?? []
  const emit = (event: string | symbol, ...args: unknown[]): void => get(event).forEach((listener) => listener(...args))

  vi.spyOn(global.process, 'listeners').mockImplementation(((event: string | symbol) => [
    ...get(event),
  ]) as typeof process.listeners)
  vi.spyOn(global.process, 'on').mockImplementation(((event: string | symbol, listener: Listener) => {
    registry.set(event, [...get(event), listener])
    return global.process
  }) as typeof process.on)
  vi.spyOn(global.process, 'removeListener').mockImplementation(((event: string | symbol, listener: Listener) => {
    registry.set(
      event,
      get(event).filter((registered) => registered !== listener)
    )
    return global.process
  }) as typeof process.removeListener)

  return {
    rejectionListenerCount: (): number => get('unhandledRejection').length,
    emit,
    // Matches EventEmitter: newListener before the listener is added, removeListener after it is removed.
    addHostRejectionListener(listener: Listener): void {
      emit('newListener', 'unhandledRejection', listener)
      registry.set('unhandledRejection', [...get('unhandledRejection'), listener])
    },
    removeHostRejectionListener(listener: Listener): void {
      registry.set(
        'unhandledRejection',
        get('unhandledRejection').filter((registered) => registered !== listener)
      )
      emit('removeListener', 'unhandledRejection', listener)
    },
  }
}

const UNHANDLED_REJECTION_HINT = {
  mechanism: {
    type: 'onunhandledrejection',
    handled: false,
  },
}

describe('exception autocapture', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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

  it('should install an uncaught-exception listener outside strict mode', () => {
    const onSpy = vi.spyOn(global.process, 'on').mockReturnValue(global.process)

    addUncaughtExceptionListener(
      () => {},
      () => {},
      'throw'
    )

    expect(onSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function))
  })

  it('should monitor uncaught exceptions without handling them in strict mode', () => {
    const capture = vi.fn()
    const onFatal = vi.fn()
    const onSpy = vi.spyOn(global.process, 'on').mockReturnValue(global.process)
    addUncaughtExceptionListener(capture, onFatal, 'strict')
    const handler = onSpy.mock.calls.find(([event]) => event === 'uncaughtExceptionMonitor')?.[1] as
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
    expect(onFatal).not.toHaveBeenCalled()
    expect(onSpy).not.toHaveBeenCalledWith('uncaughtException', expect.any(Function))
  })

  it('should not install an unhandled-rejection listener in strict mode', () => {
    const onSpy = vi.spyOn(global.process, 'on').mockReturnValue(global.process)

    addUnhandledRejectionListener(() => {}, 'strict')

    expect(onSpy).not.toHaveBeenCalled()
  })

  it.each(['throw', 'warn-with-error-code'] as const)(
    'should not install an unhandled-rejection listener in %s mode without a host listener',
    (mode) => {
      const processListeners = stubProcessListeners()

      addUnhandledRejectionListener(() => {}, mode)

      expect(processListeners.rejectionListenerCount()).toBe(0)
    }
  )

  it.each(['throw', 'warn-with-error-code'] as const)(
    'should capture unhandled rejections in %s mode when a host listener exists before init',
    (mode) => {
      const capture = vi.fn()
      const hostListener = vi.fn()
      const processListeners = stubProcessListeners([hostListener])
      const reason = new Error('host handled rejection')

      addUnhandledRejectionListener(capture, mode)
      processListeners.emit('unhandledRejection', reason, Promise.resolve())

      expect(processListeners.rejectionListenerCount()).toBe(2)
      expect(capture).toHaveBeenCalledTimes(1)
      expect(capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
      expect(hostListener).toHaveBeenCalledWith(reason, expect.any(Promise))
    }
  )

  it('should start capturing when a host listener is added after init and stop when the last one is removed', () => {
    const capture = vi.fn()
    const firstHostListener = vi.fn()
    const secondHostListener = vi.fn()
    const processListeners = stubProcessListeners()
    addUnhandledRejectionListener(capture, 'throw')
    expect(processListeners.rejectionListenerCount()).toBe(0)

    processListeners.addHostRejectionListener(firstHostListener)
    processListeners.addHostRejectionListener(secondHostListener)
    expect(processListeners.rejectionListenerCount()).toBe(3)

    const reason = new Error('late host rejection')
    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)

    processListeners.removeHostRejectionListener(firstHostListener)
    expect(processListeners.rejectionListenerCount()).toBe(2)

    processListeners.removeHostRejectionListener(secondHostListener)
    expect(processListeners.rejectionListenerCount()).toBe(0)
  })

  it('should not capture a rejection again when a host listener rethrows it', () => {
    const capture = vi.fn()
    const onFatal = vi.fn()
    const processListeners = stubProcessListeners([vi.fn()])
    addExceptionAutocaptureListeners(capture, onFatal, 'throw')
    const reason = new Error('rethrown rejection')

    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    processListeners.emit('uncaughtException', reason, 'uncaughtException')

    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
    expect(onFatal).toHaveBeenCalledWith(reason)

    const laterError = new Error('later uncaught exception')
    processListeners.emit('uncaughtException', laterError, 'uncaughtException')
    expect(capture).toHaveBeenLastCalledWith(laterError, {
      mechanism: {
        type: 'onuncaughtexception',
        handled: false,
      },
    })
  })

  it.each(['warn', 'none'] as const)('should install an unhandled-rejection listener in %s mode', (mode) => {
    const onSpy = vi.spyOn(global.process, 'on').mockReturnValue(global.process)

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
    const capture = vi.fn()
    const onSpy = vi.spyOn(global.process, 'on').mockReturnValue(global.process)
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

  it('should preserve strict mode before application unhandled-rejection listeners run', async () => {
    const [withoutSdk, withSdk] = await Promise.all([
      runUnhandledRejectionChild({
        mode: 'strict',
        scenario: 'unhandled-rejection-listener',
        withSdk: false,
      }),
      runUnhandledRejectionChild({ mode: 'strict', scenario: 'unhandled-rejection-listener' }),
    ])

    for (const result of [withoutSdk, withSdk]) {
      expect(result.signal).toBeNull()
      expect(result.code).toBe(1)
      expect(result.stdout).not.toContain('unhandled-listener')
      expect(result.stdout).not.toContain('completed')
      expect(result.stderr).toContain('Child process rejection')
    }
    expect(captureCount(withoutSdk)).toBe(0)
    expect(captureCount(withSdk)).toBe(0)
  })

  it.each(['mutated-node-options', 'mutated-exec-argv'] as const)(
    'should use snapshotted startup options after %s',
    async (scenario) => {
      const result = await runUnhandledRejectionChild({ scenario })

      expect(result.signal).toBeNull()
      expect(result.code).toBe(1)
      expect(captureCount(result)).toBe(1)
      expect(result.stdout).not.toContain('completed')
      expect(result.stderr).toContain('Child process rejection')
    }
  )

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

  it.each([
    ['before', 'throw', 'unhandled-rejection-listener'],
    ['after', 'throw', 'late-unhandled-rejection-listener'],
    ['before', 'warn-with-error-code', 'unhandled-rejection-listener'],
    ['after', 'warn-with-error-code', 'late-unhandled-rejection-listener'],
  ] as const)(
    'should capture once when the application adds an unhandled-rejection listener %s init in %s mode',
    async (_order, mode, scenario) => {
      const [withoutSdk, withSdk] = await Promise.all([
        runUnhandledRejectionChild({ mode, scenario, withSdk: false }),
        runUnhandledRejectionChild({ mode, scenario }),
      ])

      for (const result of [withoutSdk, withSdk]) {
        expect(result.signal).toBeNull()
        expect(result.code).toBe(0)
        expect(result.stdout).toContain('unhandled-listener:Child process rejection')
        expect(result.stdout).toContain('completed')
        expect(result.stderr).toBe('')
      }
      expect(captureCount(withoutSdk)).toBe(0)
      expect(captureCount(withSdk)).toBe(1)
      expect(withSdk.stdout).toContain('posthog-capture:onunhandledrejection:Child process rejection')
    }
  )

  it('should restore the default fatal rejection when the application removes its listener', async () => {
    const [withoutSdk, withSdk] = await Promise.all([
      runUnhandledRejectionChild({ mode: 'throw', scenario: 'removed-unhandled-rejection-listener', withSdk: false }),
      runUnhandledRejectionChild({ mode: 'throw', scenario: 'removed-unhandled-rejection-listener' }),
    ])

    for (const result of [withoutSdk, withSdk]) {
      expect(result.signal).toBeNull()
      expect(result.code).toBe(1)
      expect(result.stdout).not.toContain('unhandled-listener')
      expect(result.stdout).not.toContain('completed')
      expect(result.stderr).toContain('Child process rejection')
    }
    expect(captureCount(withoutSdk)).toBe(0)
    expect(captureCount(withSdk)).toBe(1)
    expect(withSdk.stdout).toContain('posthog-capture:onunhandledrejection:Child process rejection')
  })

  it.each([
    ['before init', 'rethrowing-unhandled-rejection-listener', 'onuncaughtexception'],
    ['after init', 'late-rethrowing-unhandled-rejection-listener', 'onunhandledrejection'],
  ] as const)(
    'should capture once when an application listener added %s rethrows the rejection',
    async (_order, scenario, mechanism) => {
      const [withoutSdk, withSdk] = await Promise.all([
        runUnhandledRejectionChild({ mode: 'throw', scenario, withSdk: false }),
        runUnhandledRejectionChild({ mode: 'throw', scenario }),
      ])

      for (const result of [withoutSdk, withSdk]) {
        expect(result.signal).toBeNull()
        expect(result.code).toBe(1)
        expect(result.stdout).toContain('rethrowing-listener:Child process rejection')
        expect(result.stdout).not.toContain('completed')
        expect(result.stderr).toContain('Child process rejection')
      }
      expect(captureCount(withoutSdk)).toBe(0)
      expect(captureCount(withSdk)).toBe(1)
      expect(withSdk.stdout).toContain(`posthog-capture:${mechanism}:Child process rejection`)
    }
  )

  it('captures aggregate children in one event with Node frame modifiers', async () => {
    const ph = new PostHog('TEST_API_KEY', { host: 'http://example.com' })
    const child = new TypeError('alternative')
    const aggregate = new AggregateError([child], 'group')
    // Fixed frames make the source-context and relative-path assertions deterministic.
    child.stack = `TypeError: alternative\n    at child (${__filename}:1:1)`
    aggregate.stack = `AggregateError: group\n    at root (${__filename}:2:1)`
    const capture = vi.spyOn(ph, '_capturePreparedEvent').mockResolvedValue(undefined)
    try {
      ph.captureException(aggregate)
      await ph.flush()

      expect(capture).toHaveBeenCalledTimes(1)
      const event = capture.mock.calls[0][0]
      expect(event.event).toBe('$exception')
      expect(event.properties?.$exception_list).toMatchObject([
        {
          value: 'group',
          stacktrace: {
            frames: [
              {
                filename: relative(process.cwd(), __filename),
                lineno: 2,
                context_line: expect.any(String),
                module: expect.any(String),
              },
            ],
          },
        },
        {
          value: 'alternative',
          stacktrace: {
            frames: [
              {
                filename: relative(process.cwd(), __filename),
                lineno: 1,
                context_line: expect.any(String),
                module: expect.any(String),
              },
            ],
          },
        },
      ])
      expect(event.properties?.$exception_list.map((entry: { mechanism: unknown }) => entry.mechanism)).toEqual([
        { type: 'generic', handled: true, synthetic: false, exception_id: 0 },
        { type: 'chained', source: 'member', synthetic: false, exception_id: 1, parent_id: 0 },
      ])
    } finally {
      await ph.shutdown()
    }
  })

  it('should rate limit when more than 10 of the same exception are caught', async () => {
    vi.spyOn(ErrorTracking, 'buildEventMessage').mockResolvedValue({
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
      const mockedCapture = vi.spyOn(ph, '_capturePreparedEvent').mockResolvedValue(undefined)

      const captureExceptions = Array.from({ length: 20 }).map(() => ph['errorTracking']['onException']({}, {}))
      await Promise.all(captureExceptions)
      await vi.advanceTimersByTimeAsync(0)

      // captures until rate limited
      expect(mockedCapture).toHaveBeenCalledTimes(9)
    } finally {
      await ph.shutdown()
    }
  })

  it('should honour the configured rate limiter bucket size', async () => {
    vi.spyOn(ErrorTracking, 'buildEventMessage').mockResolvedValue({
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
      const mockedCapture = vi.spyOn(ph, '_capturePreparedEvent').mockResolvedValue(undefined)

      const captureExceptions = Array.from({ length: 20 }).map(() => ph['errorTracking']['onException']({}, {}))
      await Promise.all(captureExceptions)
      await vi.advanceTimersByTimeAsync(0)

      // captures until rate limited (bucket of 3 leaves 2 through before the limiter kicks in)
      expect(mockedCapture).toHaveBeenCalledTimes(2)
    } finally {
      await ph.shutdown()
    }
  })
})
