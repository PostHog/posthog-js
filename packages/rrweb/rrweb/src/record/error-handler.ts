import type { ErrorHandler, ErrorHandlerContext } from '../types';

type Callback = (...args: unknown[]) => unknown;

let errorHandler: ErrorHandler | undefined;

export function registerErrorHandler(handler: ErrorHandler | undefined) {
  errorHandler = handler;
}

export function unregisterErrorHandler() {
  errorHandler = undefined;
}

/**
 * Wrap callbacks in a wrapper that allows to pass errors to a configured `errorHandler` method.
 *
 * Host API patches must set `context` to `host`. Their callback boundary also
 * contains the native operation, so an error handler cannot otherwise reliably
 * distinguish an application-visible native exception from recorder work.
 */
export const callbackWrapper = <T extends Callback>(
  cb: T,
  context: ErrorHandlerContext = 'rrweb',
): T => {
  if (!errorHandler) {
    return cb;
  }

  const rrwebWrapped = ((...rest: unknown[]) => {
    try {
      return cb(...rest);
    } catch (error) {
      if (errorHandler && errorHandler(error, context) === true) {
        return;
      }

      throw error;
    }
  }) as unknown as T;

  return rrwebWrapped;
};
