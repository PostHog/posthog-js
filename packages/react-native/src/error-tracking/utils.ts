import { isPromise, safeSetTimeout } from '@posthog/core'
import { GLOBAL_OBJ, isHermes, isWeb } from '../utils'
import { OptionalReactNativeExceptionsManager } from '../optional/OptionalReactNativeExceptionsManager'

type ExceptionHook = (error: unknown, isFatal: boolean, syntheticException?: Error) => void
type UncaughtExceptionHook = (error: unknown, isFatal: boolean) => void | Promise<void>

const FATAL_PERSISTENCE_TIMEOUT_MS = 2000
const NO_FATAL = Symbol('no fatal')

export function trackUnhandledRejections(tracker: ExceptionHook): void {
  if (
    isHermes() &&
    GLOBAL_OBJ?.HermesInternal?.enablePromiseRejectionTracker &&
    GLOBAL_OBJ?.HermesInternal?.hasPromise?.()
  ) {
    GLOBAL_OBJ.HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_, error: unknown) => tracker(error as Error, false),
      onHandled: () => {},
    })
  } else if (isWeb()) {
    addWebUnhandledRejectionListener(tracker)
  } else {
    throw new Error('Promise rejection tracking is only supported on Web and Hermes runtime')
  }
}

const uncaughtExceptionSubscriptions = new WeakMap<
  NonNullable<typeof GLOBAL_OBJ.ErrorUtils>,
  { trackers: Set<UncaughtExceptionHook>; restore: () => void }
>()

export function trackUncaughtExceptions(tracker: UncaughtExceptionHook): () => void {
  const errorUtils = GLOBAL_OBJ?.ErrorUtils
  if (!errorUtils?.setGlobalHandler || !errorUtils.getGlobalHandler) {
    throw new Error('ErrorUtils globalHandlers are not defined')
  }

  let subscription = uncaughtExceptionSubscriptions.get(errorUtils)
  if (!subscription) {
    const previousHandler = errorUtils.getGlobalHandler()
    const trackers = new Set<UncaughtExceptionHook>()
    // The same fatal can arrive through both hooks: the ErrorUtils handler forwards to React
    // Native's default handler, which calls ExceptionsManager.handleException. The second
    // arrival is only forwarded, by the `finally` below.
    let lastFatal: unknown = NO_FATAL
    const dispatch = (error: unknown, isFatal: boolean, forward: () => void): void => {
      const pending: Promise<void>[] = []
      try {
        if (isFatal) {
          if (lastFatal === error) {
            lastFatal = NO_FATAL
            return
          }
          lastFatal = error
        }
        for (const callback of Array.from(trackers)) {
          try {
            const result = callback(error, isFatal)
            if (isPromise(result)) {
              pending.push(Promise.resolve(result).catch(() => {}))
            }
          } catch {
            // One reporter must not prevent other reporters or React Native from handling the error.
          }
        }
      } finally {
        if (isFatal && pending.length > 0) {
          let forwarded = false
          const forwardOnce = () => {
            if (!forwarded) {
              forwarded = true
              forward()
            }
          }
          const deadline = safeSetTimeout(forwardOnce, FATAL_PERSISTENCE_TIMEOUT_MS)
          void Promise.all(pending).then(() => {
            if (!forwarded) {
              clearTimeout(deadline)
              // Keep errors thrown by the previous handler outside Promise rejection handling.
              safeSetTimeout(forwardOnce, 0)
            }
          })
        } else {
          forward()
        }
      }
    }
    const handler = (error: Error, isFatal: boolean): void => {
      dispatch(error, isFatal ?? false, () => previousHandler?.(error, isFatal))
    }
    const restoreExceptionsManager = wrapExceptionsManager((error, forward) => dispatch(error, true, forward))
    subscription = {
      trackers,
      restore: () => {
        // Leave another SDK's chain intact, but retire this empty subscription in case it is later detached.
        if (errorUtils.getGlobalHandler?.() === handler) {
          errorUtils.setGlobalHandler?.(previousHandler)
        }
        restoreExceptionsManager()
        uncaughtExceptionSubscriptions.delete(errorUtils)
      },
    }
    errorUtils.setGlobalHandler(handler)
    uncaughtExceptionSubscriptions.set(errorUtils, subscription)
  }

  const { trackers, restore } = subscription
  trackers.add(tracker)
  return () => {
    if (trackers.delete(tracker) && trackers.size === 0) {
      restore()
    }
  }
}

// React 19 reports uncaught render errors from the root `onUncaughtError` straight to
// ExceptionsManager.handleException(error, true), which never reaches ErrorUtils. Only fatal
// calls are intercepted; errors caught by an error boundary arrive with isFatal false.
function wrapExceptionsManager(onFatal: (error: unknown, forward: () => void) => void): () => void {
  try {
    const exceptionsManager = OptionalReactNativeExceptionsManager
    const original = exceptionsManager?.handleException
    if (!exceptionsManager || typeof original !== 'function') {
      return () => {}
    }
    const wrapped = (error: unknown, isFatal: boolean): void => {
      if (!isFatal) {
        return original.call(exceptionsManager, error, isFatal)
      }
      onFatal(error, () => original.call(exceptionsManager, error, isFatal))
    }
    exceptionsManager.handleException = wrapped
    return () => {
      try {
        if (exceptionsManager.handleException === wrapped) {
          exceptionsManager.handleException = original
        }
      } catch {}
    }
  } catch {
    return () => {}
  }
}

export function trackConsole(level: string, tracker: ExceptionHook): void {
  const con = console as any
  if (!con) {
    throw new Error('console not available, cannot wrap console.error')
  }

  const originalMethod = con[level]
  con[level] = function (...args: any[]): void {
    const message = args.join(' ')
    const error = args.find((arg) => arg instanceof Error)
    const syntheticException = new Error('Synthetic PostHog Error')
    tracker(error ?? message, false, syntheticException)
    return originalMethod?.(...args)
  }
}

function addWebUnhandledRejectionListener(tracker: ExceptionHook): void {
  const _oldUnhandledRejectionHandler = GLOBAL_OBJ.onunhandledrejection
  GLOBAL_OBJ.onunhandledrejection = (event) => {
    tracker(event, false)
    if (_oldUnhandledRejectionHandler) {
      _oldUnhandledRejectionHandler.apply(GLOBAL_OBJ, [event])
    }
  }
}
