import { isPromise, safeSetTimeout } from '@posthog/core'
import { GLOBAL_OBJ, isHermes, isWeb } from '../utils'

type ExceptionHook = (error: unknown, isFatal: boolean, syntheticException?: Error) => void
type UncaughtExceptionHook = (error: unknown, isFatal: boolean) => void | Promise<void>

const FATAL_PERSISTENCE_TIMEOUT_MS = 2000

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
    const handler = (error: Error, isFatal: boolean): void => {
      const pending: Promise<void>[] = []
      try {
        for (const callback of Array.from(trackers)) {
          try {
            const result = callback(error, isFatal ?? false)
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
          const forward = () => {
            if (!forwarded) {
              forwarded = true
              previousHandler?.(error, isFatal)
            }
          }
          const deadline = safeSetTimeout(forward, FATAL_PERSISTENCE_TIMEOUT_MS)
          void Promise.all(pending).then(() => {
            if (!forwarded) {
              clearTimeout(deadline)
              // Keep errors thrown by the previous handler outside Promise rejection handling.
              safeSetTimeout(forward, 0)
            }
          })
        } else {
          previousHandler?.(error, isFatal)
        }
      }
    }
    subscription = {
      trackers,
      restore: () => {
        // Another SDK may wrap our handler. Leave that chain intact and reuse our subscription set.
        if (errorUtils.getGlobalHandler?.() === handler) {
          errorUtils.setGlobalHandler?.(previousHandler)
          uncaughtExceptionSubscriptions.delete(errorUtils)
        }
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
