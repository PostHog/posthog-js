import ErrorTracking from '@/extensions/error-tracking'
import { PostHog } from '@/entrypoints/index.node'
import {
  claimExplicitCapture,
  getUnhandledRejectionMode,
  resetExceptionAutocapture,
  startExceptionAutocapture,
  sendAutocapturedEvent,
  UNHANDLED_REJECTION_GRACE_MS,
  waitForPendingRejections,
} from '@/extensions/error-tracking/autocapture'
import type { AutocaptureClient } from '@/extensions/error-tracking/autocapture'
import { AsyncLocalStorage } from 'async_hooks'
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
  | 'late-handled-rejection'
  | 'many-clients'
  | 'string-rethrowing-unhandled-rejection-listener'
  | 'error-hook-listener'
  | 'exits-without-shutdown'
  | 'client-per-request'
  | 'once-listener-before-init'
  | 'self-removing-listener-before-init'
  | 'flush-then-exit'
  | 'immediate-capture-in-uncaught-listener'

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
  vi.spyOn(global.process, 'rawListeners').mockImplementation(((event: string | symbol) => [
    ...get(event),
  ]) as typeof process.rawListeners)
  vi.spyOn(global.process, 'on').mockImplementation(((event: string | symbol, listener: Listener) => {
    registry.set(event, [...get(event), listener])
    return global.process
  }) as typeof process.on)
  vi.spyOn(global.process, 'prependListener').mockImplementation(((event: string | symbol, listener: Listener) => {
    registry.set(event, [listener, ...get(event)])
    return global.process
  }) as typeof process.prependListener)
  vi.spyOn(global.process, 'removeListener').mockImplementation(((event: string | symbol, listener: Listener) => {
    registry.set(
      event,
      get(event).filter((registered) => registered !== listener)
    )
    return global.process
  }) as typeof process.removeListener)
  // Only the events the SDK emits itself. Every other event passes through: vitest's workers receive their RPC
  // replies as process 'message' events.
  const realEmit = global.process.emit.bind(global.process) as (event: string | symbol, ...args: unknown[]) => boolean
  vi.spyOn(global.process, 'emit').mockImplementation(((event: string | symbol, ...args: unknown[]) => {
    if (event !== 'uncaughtException' && event !== 'uncaughtExceptionMonitor') {
      return realEmit(event, ...args)
    }
    emit(event, ...args)
    return get(event).length > 0
  }) as typeof process.emit)
  const exit = vi.spyOn(global.process, 'exit').mockImplementation((() => undefined) as typeof process.exit)
  const emitWarning = vi.spyOn(global.process, 'emitWarning').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  return {
    listenerCount: (event: string): number => get(event).length,
    emit,
    exit,
    emitWarning,
    // Matches EventEmitter: newListener before the listener is added, removeListener after it is removed.
    addHostRejectionListener(listener: Listener): void {
      emit('newListener', 'unhandledRejection', listener)
      registry.set('unhandledRejection', [...get('unhandledRejection'), listener])
    },
    removeHostRejectionListenerSilently(listener: Listener): void {
      registry.set(
        'unhandledRejection',
        get('unhandledRejection').filter((registered) => registered !== listener)
      )
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

function makeClient(key = 'api_key@https://us.i.posthog.com'): AutocaptureClient & {
  capture: ReturnType<typeof vi.fn>
  getContext: ReturnType<typeof vi.fn>
  drain: ReturnType<typeof vi.fn>
  shutdown: ReturnType<typeof vi.fn>
} {
  return {
    key,
    capture: vi.fn(),
    getContext: vi.fn(),
    drain: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }
}

const UNHANDLED_REJECTION_HINT = {
  mechanism: {
    type: 'onunhandledrejection',
    handled: false,
  },
}

const UNCAUGHT_EXCEPTION_HINT = {
  mechanism: {
    type: 'onuncaughtexception',
    handled: false,
  },
}

describe('exception autocapture', () => {
  afterEach(async () => {
    // Lets a fatal exit started by the test reach the stubbed process.exit before the stubs are restored.
    await vi.advanceTimersByTimeAsync(0)
    resetExceptionAutocapture()
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
    const processListeners = stubProcessListeners()

    startExceptionAutocapture(makeClient(), 'throw')

    expect(processListeners.listenerCount('uncaughtException')).toBe(1)
  })

  it('should monitor uncaught exceptions without handling them in strict mode', () => {
    const processListeners = stubProcessListeners()
    const client = makeClient()
    startExceptionAutocapture(client, 'strict')
    const reason = new Error('promoted rejection')

    processListeners.emit('uncaughtExceptionMonitor', reason, 'unhandledRejection')

    expect(client.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
    expect(processListeners.listenerCount('uncaughtException')).toBe(0)
    expect(processListeners.listenerCount('unhandledRejection')).toBe(0)
    expect(processListeners.exit).not.toHaveBeenCalled()
  })

  it.each(['throw', 'warn-with-error-code'] as const)(
    'should not install an unhandled-rejection listener in %s mode without a host listener',
    (mode) => {
      const processListeners = stubProcessListeners()

      startExceptionAutocapture(makeClient(), mode)

      expect(processListeners.listenerCount('unhandledRejection')).toBe(0)
    }
  )

  it.each(['throw', 'warn-with-error-code'] as const)(
    'should capture an unhandled rejection in %s mode once its grace period passes, when a host listener exists',
    async (mode) => {
      const client = makeClient()
      const hostListener = vi.fn()
      const processListeners = stubProcessListeners([hostListener])
      const reason = new Error('host handled rejection')

      startExceptionAutocapture(client, mode)
      processListeners.emit('unhandledRejection', reason, Promise.resolve())

      expect(processListeners.listenerCount('unhandledRejection')).toBe(2)
      expect(hostListener).toHaveBeenCalledWith(reason, expect.any(Promise))
      expect(client.capture).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

      expect(client.capture).toHaveBeenCalledTimes(1)
      expect(client.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
    }
  )

  it('should not capture a rejection that the app handles during the grace period', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const promise = Promise.resolve()

    processListeners.emit('unhandledRejection', new Error('handled late'), promise)
    processListeners.emit('rejectionHandled', promise)
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).not.toHaveBeenCalled()
    // Node prints this warning when no other listener takes rejectionHandled.
    expect(processListeners.emitWarning).toHaveBeenCalledWith(
      'Promise rejection was handled asynchronously',
      'PromiseRejectionHandledWarning'
    )
  })

  it('should start capturing when a host listener is added after init and stop when the last one is removed', async () => {
    const client = makeClient()
    const firstHostListener = vi.fn()
    const secondHostListener = vi.fn()
    const processListeners = stubProcessListeners()
    startExceptionAutocapture(client, 'throw')
    expect(processListeners.listenerCount('unhandledRejection')).toBe(0)

    processListeners.addHostRejectionListener(firstHostListener)
    processListeners.addHostRejectionListener(secondHostListener)
    expect(processListeners.listenerCount('unhandledRejection')).toBe(3)

    const reason = new Error('late host rejection')
    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)
    expect(client.capture).toHaveBeenCalledTimes(1)
    expect(client.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)

    processListeners.removeHostRejectionListener(firstHostListener)
    expect(processListeners.listenerCount('unhandledRejection')).toBe(2)

    processListeners.removeHostRejectionListener(secondHostListener)
    expect(processListeners.listenerCount('unhandledRejection')).toBe(0)
  })

  it.each([
    ['exits', false],
    ['leaves the process to the app', true],
  ] as const)(
    'should escalate the rejection like Node when the host listener disappeared without an event, and %s',
    async (_name, appHandlesUncaught) => {
      const client = makeClient()
      const hostListener = vi.fn()
      const processListeners = stubProcessListeners([hostListener])
      const appUncaughtListener = vi.fn()
      if (appHandlesUncaught) {
        process.on('uncaughtException', appUncaughtListener)
      }
      startExceptionAutocapture(client, 'throw')
      const ourListener = process.listeners('unhandledRejection').find((listener) => listener !== hostListener)!
      const reason = new Error('rejection after the host left')

      // A host removal that emits no event, as in Bun.
      processListeners.removeHostRejectionListenerSilently(hostListener)
      ourListener(reason, Promise.resolve())
      await vi.advanceTimersByTimeAsync(0)

      expect(client.capture).toHaveBeenCalledTimes(1)
      expect(client.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
      if (appHandlesUncaught) {
        expect(appUncaughtListener).toHaveBeenCalledWith(reason, 'unhandledRejection')
        expect(processListeners.exit).not.toHaveBeenCalled()
      } else {
        expect(processListeners.exit).toHaveBeenCalledWith(1)
      }
    }
  )

  it('should capture a rejection once when the host listener rethrows it', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const reason = new Error('rethrown rejection')

    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    processListeners.emit('uncaughtException', reason, 'uncaughtException')
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).toHaveBeenCalledTimes(1)
    expect(client.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
    expect(client.shutdown).toHaveBeenCalled()
    expect(processListeners.exit).toHaveBeenCalledWith(1)
  })

  it('should capture a string rejection once when the host listener rethrows it', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')

    processListeners.emit('unhandledRejection', 'string reason', Promise.resolve())
    processListeners.emit('uncaughtException', 'string reason', 'uncaughtException')
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).toHaveBeenCalledTimes(1)
    expect(client.capture).toHaveBeenCalledWith('string reason', UNHANDLED_REJECTION_HINT)
  })

  it('should capture a rejection once when the runtime reports the rethrow before our rejection listener runs', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const reason = new Error('rethrown first')

    // Bun's order: the host listener's throw reaches uncaughtException before the next rejection listener runs.
    processListeners.emit('uncaughtException', reason, 'uncaughtException')
    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).toHaveBeenCalledTimes(1)
  })

  it('should capture a rejection once when the same listener receives it twice', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const reason = new Error('delivered twice')
    const promise = Promise.resolve()

    // Next.js 16's filter can hand a rejection to a listener that is both on the process and in its queue.
    processListeners.emit('unhandledRejection', reason, promise)
    processListeners.emit('unhandledRejection', reason, promise)
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).toHaveBeenCalledTimes(1)
  })

  it('should capture a separate occurrence of the same error object again', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const reason = new Error('aborted')

    // An AbortSignal reason rejects a fetch nobody awaits, and is later thrown again by throwIfAborted().
    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)
    // Lets the end-of-turn reset run, as it would before any later turn.
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1)
    processListeners.emit('uncaughtException', reason, 'uncaughtException')

    expect(client.capture).toHaveBeenCalledTimes(2)
    expect(client.capture).toHaveBeenLastCalledWith(reason, UNCAUGHT_EXCEPTION_HINT)
  })

  it('should capture both occurrences when the same error object is thrown during the grace period', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const reason = new Error('aborted')

    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    await vi.advanceTimersByTimeAsync(50)
    processListeners.emit('uncaughtException', reason, 'uncaughtException')

    expect(client.capture).toHaveBeenCalledTimes(2)
    expect(client.capture).toHaveBeenNthCalledWith(1, reason, UNHANDLED_REJECTION_HINT)
    expect(client.capture).toHaveBeenNthCalledWith(2, reason, UNCAUGHT_EXCEPTION_HINT)
  })

  it('should capture a rejection once when the host rethrows it from an immediate', async () => {
    const client = makeClient()
    const reason = new Error('rethrown later')
    // Next.js 16's filter catches a queued listener's error and rethrows it with setImmediate.
    const processListeners = stubProcessListeners([
      (rejection: unknown) =>
        setImmediate(() => processListeners.emit('uncaughtException', rejection, 'uncaughtException')),
    ])
    startExceptionAutocapture(client, 'throw')

    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).toHaveBeenCalledTimes(1)
    expect(client.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
  })

  it('should capture two rejections with the same primitive reason as two', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')

    processListeners.emit('unhandledRejection', 'timeout', Promise.resolve())
    processListeners.emit('unhandledRejection', 'timeout', Promise.resolve())
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).toHaveBeenCalledTimes(2)
  })

  it('should treat a later capture of the same error object as a new occurrence', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners()
    startExceptionAutocapture(client, 'throw')
    const error = new Error('cached failure')
    process.on('uncaughtException', vi.fn())

    processListeners.emit('uncaughtException', error, 'uncaughtException')
    // A framework's error hook handing the same occurrence to captureException.
    expect(claimExplicitCapture(error, client.key)).toBe(false)

    // A later request capturing the cached error, and a later throw of it.
    await vi.advanceTimersByTimeAsync(10)
    expect(claimExplicitCapture(error, client.key)).toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    processListeners.emit('uncaughtException', error, 'uncaughtException')
    expect(client.capture).toHaveBeenCalledTimes(2)
  })

  it('should let captureException report a rejection in its grace period, once', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const reason = new Error('handed to an error hook')

    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    await vi.advanceTimersByTimeAsync(10)
    expect(claimExplicitCapture(reason, client.key)).toBe(true)
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).not.toHaveBeenCalled()
  })

  it('should capture once per project, however many clients there are', () => {
    const processListeners = stubProcessListeners([vi.fn()])
    const sameProject = [makeClient(), makeClient()]
    const otherProject = makeClient('other_key@https://us.i.posthog.com')
    for (const client of [...sameProject, otherProject]) {
      startExceptionAutocapture(client, 'throw')
    }

    expect(processListeners.listenerCount('uncaughtException')).toBe(1)
    expect(processListeners.listenerCount('unhandledRejection')).toBe(2)

    processListeners.emit('uncaughtException', new Error('one exception'), 'uncaughtException')
    expect(sameProject[0].capture.mock.calls.length + sameProject[1].capture.mock.calls.length).toBe(1)
    expect(otherProject.capture).toHaveBeenCalledTimes(1)
  })

  it('should keep capturing through the last client of a project after it shuts down', async () => {
    const processListeners = stubProcessListeners([vi.fn()])
    // A client per request: created, used, shut down.
    const requestClient = makeClient()
    startExceptionAutocapture(requestClient, 'throw')()
    const reason = new Error('after the request finished')

    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)
    expect(requestClient.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)

    // The next request's client takes over.
    const nextClient = makeClient()
    startExceptionAutocapture(nextClient, 'throw')
    processListeners.emit('uncaughtException', new Error('during the next request'), 'uncaughtException')
    expect(nextClient.capture).toHaveBeenCalledTimes(1)
    expect(requestClient.capture).toHaveBeenCalledTimes(1)
  })

  it('should leave a rejection in its grace period when another client of the project is still running', async () => {
    const processListeners = stubProcessListeners([vi.fn()])
    const first = makeClient()
    const second = makeClient()
    const stopFirst = startExceptionAutocapture(first, 'throw')
    startExceptionAutocapture(second, 'throw')
    const promise = Promise.resolve()

    processListeners.emit('unhandledRejection', new Error('handled late'), promise)
    stopFirst()
    processListeners.emit('rejectionHandled', promise)
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(first.capture).not.toHaveBeenCalled()
    expect(second.capture).not.toHaveBeenCalled()
  })

  it.each([
    ['the request it happened in', { request: 'a' }],
    ['no request, when it happened outside one', undefined],
  ] as const)(
    'should capture a rejection in its grace period with %s, wherever the capture is triggered',
    (_name, requestOfRejection) => {
      const requests = new AsyncLocalStorage<{ request: string }>()
      const contexts: unknown[] = []
      const client = makeClient()
      client.capture.mockImplementation(() => contexts.push(requests.getStore()))
      const processListeners = stubProcessListeners([vi.fn()])
      const stop = startExceptionAutocapture(client, 'throw')
      const reject = (): void => processListeners.emit('unhandledRejection', new Error('pending'), Promise.resolve())

      if (requestOfRejection) {
        requests.run(requestOfRejection, reject)
      } else {
        reject()
      }
      // The client shuts down inside another request, as at the end of a request handler.
      requests.run({ request: 'b' }, stop)

      expect(contexts).toEqual([requestOfRejection])
    }
  )

  it('should capture through the client of a project whose request context is active', () => {
    const processListeners = stubProcessListeners([vi.fn()])
    const outside = makeClient()
    const inRequest = makeClient()
    inRequest.getContext.mockReturnValue({ distinctId: 'user-1' })
    startExceptionAutocapture(outside, 'throw')
    startExceptionAutocapture(inRequest, 'throw')
    process.on('uncaughtException', vi.fn())

    processListeners.emit('uncaughtException', new Error('in a request'), 'uncaughtException')

    expect(outside.capture).not.toHaveBeenCalled()
    expect(inRequest.capture).toHaveBeenCalledTimes(1)
  })

  it('should send the autocaptured event when captureExceptionImmediate skips the duplicate', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners()
    startExceptionAutocapture(client, 'throw')
    process.on('uncaughtException', vi.fn())
    const error = new Error('captured twice')

    processListeners.emit('uncaughtException', error, 'uncaughtException')
    expect(claimExplicitCapture(error, client.key)).toBe(false)
    await sendAutocapturedEvent(error, client.key)

    expect(client.drain).toHaveBeenCalledTimes(1)
  })

  it('should send what another client of the project captured when a client flushes', async () => {
    const processListeners = stubProcessListeners([vi.fn()])
    const owner = makeClient()
    const flushing = makeClient()
    startExceptionAutocapture(owner, 'throw')
    startExceptionAutocapture(flushing, 'throw')

    processListeners.emit('unhandledRejection', new Error('pending'), Promise.resolve())
    const waited = waitForPendingRejections(flushing)
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)
    await waited

    expect(owner.capture).toHaveBeenCalledTimes(1)
    expect(owner.drain).toHaveBeenCalledTimes(1)
  })

  it('should not capture a rejection again when the app captured it just before it was thrown', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const reason = new Error('captured, then thrown from an async function')

    expect(claimExplicitCapture(reason, client.key)).toBe(true)
    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).not.toHaveBeenCalled()
  })

  it('should capture rejections in their grace period before the process exits on its own', () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const reason = new Error('just before exit')

    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    processListeners.emit('beforeExit', 0)

    expect(client.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
    expect(client.drain).toHaveBeenCalled()
  })

  it.each([
    ['captured', false],
    ['handled', true],
  ] as const)('should hold a flush until a rejection in its grace period is %s', async (_outcome, handled) => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const promise = Promise.resolve()
    let waited = false

    processListeners.emit('unhandledRejection', new Error('pending at flush'), promise)
    void waitForPendingRejections(client).then(() => (waited = true))
    await vi.advanceTimersByTimeAsync(10)
    expect(waited).toBe(false)

    if (handled) {
      processListeners.emit('rejectionHandled', promise)
    } else {
      await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)
    }
    await vi.advanceTimersByTimeAsync(0)

    expect(waited).toBe(true)
    expect(client.capture).toHaveBeenCalledTimes(handled ? 0 : 1)
  })

  it('should keep a serverless runtime alive until a rejection in its grace period is sent', async () => {
    const keepAlive = vi.fn()
    const client = { ...makeClient(), keepAlive }
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')

    // A burst: one keep-alive and one send cover all of them.
    for (let index = 0; index < 1000; index++) {
      processListeners.emit('unhandledRejection', new Error('before the freeze'), Promise.resolve())
    }
    expect(keepAlive).toHaveBeenCalledTimes(1)
    expect(client.drain).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)
    await keepAlive.mock.calls[0][0]
    expect(client.capture).toHaveBeenCalledTimes(1000)
    expect(client.drain).toHaveBeenCalledTimes(1)
  })

  it('should listen for rejectionHandled only while a rejection is in its grace period', async () => {
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(makeClient(), 'throw')
    expect(processListeners.listenerCount('rejectionHandled')).toBe(0)

    processListeners.emit('unhandledRejection', new Error('pending'), Promise.resolve())
    expect(processListeners.listenerCount('rejectionHandled')).toBe(1)

    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)
    expect(processListeners.listenerCount('rejectionHandled')).toBe(0)
  })

  it('should send rejections in their grace period when a client stops', () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    const stop = startExceptionAutocapture(client, 'throw')
    const reason = new Error('pending at shutdown')

    processListeners.emit('unhandledRejection', reason, Promise.resolve())
    stop()

    expect(client.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
  })

  it('should not capture an error through captureException after autocapture sent it to the same project', () => {
    const client = makeClient()
    const processListeners = stubProcessListeners()
    startExceptionAutocapture(client, 'throw')
    const error = new Error('handed to an error hook')

    processListeners.emit('uncaughtException', error, 'uncaughtException')

    expect(claimExplicitCapture(error, client.key)).toBe(false)
    expect(claimExplicitCapture(error, 'other_key@https://us.i.posthog.com')).toBe(true)
    expect(claimExplicitCapture('a string', client.key)).toBe(true)
  })

  it('should not autocapture an error the app already captured itself', () => {
    const client = makeClient()
    const processListeners = stubProcessListeners()
    startExceptionAutocapture(client, 'throw')
    const error = new Error('caught, captured and rethrown')

    expect(claimExplicitCapture(error, client.key)).toBe(true)
    processListeners.emit('uncaughtException', error, 'uncaughtException')

    expect(client.capture).not.toHaveBeenCalled()
    expect(processListeners.exit).toHaveBeenCalledTimes(0)
  })

  it('should ignore framework control flow and aborts', async () => {
    const client = makeClient()
    const processListeners = stubProcessListeners([vi.fn()])
    startExceptionAutocapture(client, 'throw')
    const postpone = Object.assign(new Error('postponed'), { $$typeof: Symbol.for('react.postpone') })
    const hangingPromise = Object.assign(new Error('hanging'), { digest: 'HANGING_PROMISE_REJECTION' })
    const wrapped = new Error('wrapper', {
      cause: Object.assign(new Error('bailout'), { digest: 'DYNAMIC_SERVER_USAGE' }),
    })
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })

    for (const reason of [postpone, hangingPromise, wrapped, abort]) {
      processListeners.emit('unhandledRejection', reason, Promise.resolve())
    }
    await vi.advanceTimersByTimeAsync(UNHANDLED_REJECTION_GRACE_MS)

    expect(client.capture).not.toHaveBeenCalled()
  })

  it.each(['warn', 'none'] as const)('should install an unhandled-rejection listener in %s mode', (mode) => {
    const processListeners = stubProcessListeners()

    startExceptionAutocapture(makeClient(), mode)

    expect(processListeners.listenerCount('unhandledRejection')).toBe(1)
  })

  it.each(['throw', 'warn'] as const)(
    'should listen again in %s mode after a host clears every listener and adds its own',
    (mode) => {
      const processListeners = stubProcessListeners([vi.fn()])
      startExceptionAutocapture(makeClient(), mode)
      expect(processListeners.listenerCount('unhandledRejection')).toBe(2)

      // Next.js's experimental removeUncaughtErrorAndRejectionListeners does this.
      for (const listener of process.listeners('unhandledRejection')) {
        process.removeListener('unhandledRejection', listener as Listener)
      }
      expect(processListeners.listenerCount('unhandledRejection')).toBe(0)
      processListeners.addHostRejectionListener(vi.fn())

      expect(processListeners.listenerCount('unhandledRejection')).toBe(2)
    }
  )

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
    const client = makeClient()
    const processListeners = stubProcessListeners()
    startExceptionAutocapture(client, 'throw')
    const reason = new Error('promoted rejection')

    processListeners.emit('uncaughtException', reason, 'unhandledRejection')

    expect(client.capture).toHaveBeenCalledWith(reason, UNHANDLED_REJECTION_HINT)
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
      runUnhandledRejectionChild({
        mode: 'throw',
        scenario: 'removed-unhandled-rejection-listener',
        withSdk: false,
      }),
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
    // Ours runs before the host's listener either way, so the rethrow is matched to the rejection it was.
    ['before init', 'rethrowing-unhandled-rejection-listener', 'onunhandledrejection'],
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

  it('should not capture a rejection the application handles shortly after Node reports it', async () => {
    const [withoutSdk, withSdk] = await Promise.all([
      runUnhandledRejectionChild({ mode: 'throw', scenario: 'late-handled-rejection', withSdk: false }),
      runUnhandledRejectionChild({ mode: 'throw', scenario: 'late-handled-rejection' }),
    ])

    for (const result of [withoutSdk, withSdk]) {
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('unhandled-listener:Child process rejection')
      expect(result.stdout).toContain('handled-late')
      expect(result.stdout).toContain('completed')
      expect(result.stderr).toContain('PromiseRejectionHandledWarning')
    }
    expect(captureCount(withSdk)).toBe(0)
  })

  it('should capture a rejection once however many clients the application creates', async () => {
    const result = await runUnhandledRejectionChild({ mode: 'throw', scenario: 'many-clients' })

    expect(result.code).toBe(0)
    expect(captureCount(result)).toBe(1)
    expect(result.stderr).not.toContain('MaxListenersExceededWarning')
  })

  it('should capture a string rejection once when an application listener rethrows it', async () => {
    const [withoutSdk, withSdk] = await Promise.all([
      runUnhandledRejectionChild({
        mode: 'throw',
        scenario: 'string-rethrowing-unhandled-rejection-listener',
        withSdk: false,
      }),
      runUnhandledRejectionChild({ mode: 'throw', scenario: 'string-rethrowing-unhandled-rejection-listener' }),
    ])

    for (const result of [withoutSdk, withSdk]) {
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('rethrowing-listener:Child process rejection')
      expect(result.stdout).not.toContain('completed')
    }
    expect(captureCount(withSdk)).toBe(1)
  })

  it('should capture a rejection once when the host also passes it to captureException', async () => {
    const result = await runUnhandledRejectionChild({ mode: 'throw', scenario: 'error-hook-listener' })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('completed')
    expect(captureCount(result)).toBe(1)
  })

  it.each([
    ['ends on its own without shutting the client down', 'exits-without-shutdown'],
    ['rejects after its client per request shut down', 'client-per-request'],
  ] as const)('should capture a rejection when the process %s', async (_name, scenario) => {
    const result = await runUnhandledRejectionChild({ mode: 'throw', scenario })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('unhandled-listener:Child process rejection')
    expect(captureCount(result)).toBe(1)
  })

  it.each(['once-listener-before-init', 'self-removing-listener-before-init'] as const)(
    'should leave the process running when a host listener from before init removes itself (%s)',
    async (scenario) => {
      const [withoutSdk, withSdk] = await Promise.all([
        runUnhandledRejectionChild({ mode: 'throw', scenario, withSdk: false }),
        runUnhandledRejectionChild({ mode: 'throw', scenario }),
      ])

      for (const result of [withoutSdk, withSdk]) {
        expect(result.code).toBe(0)
        expect(result.stdout).toContain('unhandled-listener:Child process rejection')
        expect(result.stdout).toContain('completed')
      }
      expect(captureCount(withSdk)).toBe(1)
    }
  )

  it('should send the exception before captureExceptionImmediate resolves, though autocapture captured it first', async () => {
    const result = await runUnhandledRejectionChild({
      mode: 'throw',
      scenario: 'immediate-capture-in-uncaught-listener',
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/posthog-capture:onuncaughtexception:Child process exception\nexiting/)
    expect(captureCount(result)).toBe(1)
  })

  it('should send a rejection in its grace period with the next flush', async () => {
    const result = await runUnhandledRejectionChild({ mode: 'throw', scenario: 'flush-then-exit' })

    expect(result.code).toBe(0)
    expect(captureCount(result)).toBe(1)
  })

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
