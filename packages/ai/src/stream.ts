interface SDKStream<Item> extends AsyncIterable<Item> {
  controller?: AbortController
}

type StreamFactory<Item, StreamType extends AsyncIterable<Item>> = (
  iterator: () => AsyncIterator<Item>,
  controller: AbortController
) => StreamType

/**
 * Splits an SDK stream into a monitoring branch and a caller branch without
 * allowing either branch to read ahead of the other. Unlike the SDKs' `tee()`
 * implementations, this keeps at most one result in flight and makes caller
 * cancellation terminate the monitoring branch and the source iterator.
 */
export function monitoredStreamTee<Item, StreamType extends SDKStream<Item>>(
  source: StreamType,
  createStream: StreamFactory<Item, StreamType>
): [AsyncIterable<Item>, StreamType] {
  const controller = source.controller ?? new AbortController()
  const sourceIterator = source[Symbol.asyncIterator]()

  type Pending = {
    resolve: (result: IteratorResult<Item>) => void
    reject: (error: unknown) => void
  }

  const callerQueue: Pending[] = []
  let monitorPending: Pending | undefined
  let monitorActive = true
  let operationInFlight = false
  let terminalResult: IteratorResult<Item> | undefined
  let bufferedMonitorResult: IteratorResult<Item> | undefined
  let terminalError: unknown
  let hasTerminalError = false
  let cancellationPromise: Promise<IteratorResult<Item>> | undefined
  let abortListener: (() => void) | undefined

  const removeAbortListener = (): void => {
    if (abortListener) {
      controller.signal.removeEventListener('abort', abortListener)
      abortListener = undefined
    }
  }

  const settleMonitorTerminal = (): void => {
    if (!monitorPending) {
      return
    }

    const pending = monitorPending
    monitorPending = undefined
    if (hasTerminalError) {
      pending.reject(terminalError)
    } else if (terminalResult) {
      pending.resolve(terminalResult)
    }
  }

  const settleCallersTerminal = (): void => {
    while (callerQueue.length > 0) {
      const pending = callerQueue.shift()!
      if (hasTerminalError) {
        pending.reject(terminalError)
      } else if (terminalResult) {
        pending.resolve(terminalResult)
      }
    }
  }

  const pump = (): void => {
    if (operationInFlight || callerQueue.length === 0 || (monitorActive && !monitorPending)) {
      return
    }

    const pendingCaller = callerQueue.shift()!
    const pendingMonitor = monitorPending
    monitorPending = undefined
    operationInFlight = true

    void sourceIterator.next().then(
      (result) => {
        operationInFlight = false
        if (result.done) {
          terminalResult = result
          removeAbortListener()
        }
        pendingCaller.resolve(result)
        pendingMonitor?.resolve(result)
        if (result.done) {
          settleCallersTerminal()
        } else {
          pump()
        }
      },
      (error: unknown) => {
        operationInFlight = false
        terminalError = error
        hasTerminalError = true
        removeAbortListener()
        pendingCaller.reject(error)
        pendingMonitor?.reject(error)
        settleCallersTerminal()
      }
    )
  }

  const monitoringStream: AsyncIterable<Item> = {
    [Symbol.asyncIterator](): AsyncIterator<Item> {
      return {
        next: () => {
          if (hasTerminalError) {
            return Promise.reject(terminalError)
          }
          if (terminalResult) {
            return Promise.resolve(terminalResult)
          }
          if (bufferedMonitorResult) {
            const result = bufferedMonitorResult
            bufferedMonitorResult = undefined
            return Promise.resolve(result)
          }
          return new Promise<IteratorResult<Item>>((resolve, reject) => {
            monitorPending = { resolve, reject }
            pump()
          })
        },
        return: async (value?: unknown) => {
          monitorActive = false
          monitorPending = undefined
          pump()
          return { done: true, value: value as Item }
        },
      }
    },
  }

  const cancelSource = (value?: unknown): Promise<IteratorResult<Item>> => {
    if (cancellationPromise) {
      return cancellationPromise
    }

    removeAbortListener()
    if (!controller.signal.aborted) {
      controller.abort()
    }

    cancellationPromise = (async () => {
      try {
        const defaultResult: IteratorResult<Item> = { done: true, value }
        const result = sourceIterator.return ? await sourceIterator.return(value) : defaultResult
        if (result.done) {
          terminalResult = result
          removeAbortListener()
          settleMonitorTerminal()
          settleCallersTerminal()
        } else if (monitorPending) {
          monitorPending.resolve(result)
          monitorPending = undefined
          cancellationPromise = undefined
        } else {
          bufferedMonitorResult = result
          cancellationPromise = undefined
        }
        return result
      } catch (error: unknown) {
        terminalError = error
        hasTerminalError = true
        removeAbortListener()
        settleMonitorTerminal()
        settleCallersTerminal()
        throw error
      }
    })()
    // An AbortController cancellation has no caller awaiting this promise.
    void cancellationPromise.catch(() => undefined)
    return cancellationPromise
  }

  abortListener = (): void => {
    void cancelSource()
  }
  if (controller.signal.aborted) {
    abortListener()
  } else {
    controller.signal.addEventListener('abort', abortListener, { once: true })
  }

  const callerStream = createStream(
    () => ({
      next: () => {
        if (hasTerminalError) {
          return Promise.reject(terminalError)
        }
        if (terminalResult) {
          return Promise.resolve(terminalResult)
        }
        return new Promise<IteratorResult<Item>>((resolve, reject) => {
          callerQueue.push({ resolve, reject })
          pump()
        })
      },
      return: (value?: unknown) => cancelSource(value),
      throw: async (error?: unknown) => {
        if (!sourceIterator.throw) {
          await cancelSource()
          throw error
        }

        try {
          const result = await sourceIterator.throw(error)
          if (result.done) {
            terminalResult = result
            removeAbortListener()
            settleCallersTerminal()
          }
          if (monitorPending) {
            monitorPending.resolve(result)
            monitorPending = undefined
          } else {
            bufferedMonitorResult = result
          }
          return result
        } catch (sourceError: unknown) {
          terminalError = sourceError
          hasTerminalError = true
          removeAbortListener()
          settleMonitorTerminal()
          settleCallersTerminal()
          throw sourceError
        }
      },
    }),
    controller
  )

  return [monitoringStream, callerStream]
}
