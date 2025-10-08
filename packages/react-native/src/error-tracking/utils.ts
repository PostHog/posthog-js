import { GLOBAL_OBJ, isHermes, isWeb } from '../utils'

type ExceptionHook = (error: unknown, isFatal: boolean) => void

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

export function trackUncaughtExceptions(tracker: ExceptionHook): void {
  if (GLOBAL_OBJ?.ErrorUtils && GLOBAL_OBJ.ErrorUtils?.setGlobalHandler && GLOBAL_OBJ.ErrorUtils?.getGlobalHandler) {
    const globalHandler = ErrorUtils.getGlobalHandler()
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      tracker(error as Error, isFatal ?? false)
      globalHandler?.(error, isFatal)
    })
  } else {
    throw new Error('ErrorUtils globalHandlers are not defined')
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
