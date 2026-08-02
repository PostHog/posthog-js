import { Stream as OpenAIStream } from 'openai/streaming'
import { monitoredStreamTee } from '../src/stream'

interface TestStream<Item> extends AsyncIterable<Item> {
  controller?: AbortController
}

const createTestStream = <Item>(
  iterator: () => AsyncIterator<Item>,
  controller: AbortController
): TestStream<Item> => ({
  controller,
  [Symbol.asyncIterator]: iterator,
})

describe('monitorStream', () => {
  test('forwards throw and return while keeping the monitor in lockstep', async () => {
    const controller = new AbortController()
    const recovered = { sequence: 1 }
    const returned = { sequence: 2 }
    const sourceThrow = jest.fn().mockResolvedValue({ done: false, value: recovered })
    const sourceReturn = jest.fn().mockResolvedValue({ done: true, value: returned })
    const sourceIterator: AsyncIterator<{ sequence: number }> = {
      next: jest.fn().mockResolvedValue({ done: true, value: undefined }),
      throw: sourceThrow,
      return: sourceReturn,
    }
    const source = new OpenAIStream(() => sourceIterator, controller)
    const monitored: Array<{ sequence: number }> = []

    const [monitoringStream, wrapped] = monitoredStreamTee<{ sequence: number }, OpenAIStream<{ sequence: number }>>(
      source,
      (iterator, streamController) => new OpenAIStream(iterator, streamController)
    )
    const monitoringPromise = (async () => {
      for await (const item of monitoringStream) {
        monitored.push(item)
      }
    })()
    const iterator = wrapped[Symbol.asyncIterator]()
    const injectedError = new Error('injected by caller')

    await expect(iterator.throw?.(injectedError)).resolves.toEqual({ done: false, value: recovered })
    expect(sourceThrow).toHaveBeenCalledWith(injectedError)
    await expect(iterator.return?.(returned)).resolves.toEqual({ done: true, value: returned })
    expect(sourceReturn).toHaveBeenCalledWith(returned)
    await monitoringPromise
    expect(monitored).toEqual([recovered])
  })

  test('aborting the returned SDK stream cancels the source while next is in flight', async () => {
    const controller = new AbortController()
    let sourceFinalized = false
    const sourceIterator = (async function* () {
      try {
        yield 1
        await new Promise<void>((resolve) => {
          if (controller.signal.aborted) {
            resolve()
          } else {
            controller.signal.addEventListener('abort', () => resolve(), { once: true })
          }
        })
      } finally {
        sourceFinalized = true
      }
    })()
    const sourceReturn = jest.spyOn(sourceIterator, 'return')
    const source = new OpenAIStream<number>(() => sourceIterator, controller)
    const monitored: number[] = []

    const [monitoringStream, wrapped] = monitoredStreamTee<number, OpenAIStream<number>>(
      source,
      (iterator, streamController) => new OpenAIStream(iterator, streamController)
    )
    const monitoringPromise = (async () => {
      for await (const item of monitoringStream) {
        monitored.push(item)
      }
    })()
    const iterator = wrapped[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
    const pendingNext = iterator.next()
    await new Promise<void>((resolve) => process.nextTick(resolve))
    wrapped.controller.abort()

    await expect(pendingNext).resolves.toEqual({ done: true, value: undefined })
    await monitoringPromise
    expect(monitored).toEqual([1])
    expect(sourceReturn).toHaveBeenCalledTimes(1)
    expect(sourceFinalized).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  test('resolves 3+ concurrent next calls in FIFO order without reading ahead of the monitor', async () => {
    const sourceIterator = (async function* () {
      yield 1
      yield 2
      yield 3
    })()
    const sourceNext = jest.spyOn(sourceIterator, 'next')
    const source = createTestStream(() => sourceIterator, new AbortController())
    const [monitoringStream, wrapped] = monitoredStreamTee<number, TestStream<number>>(source, createTestStream)
    const monitored: number[] = []
    const monitoringPromise = (async () => {
      for await (const item of monitoringStream) {
        monitored.push(item)
      }
    })()
    const iterator = wrapped[Symbol.asyncIterator]()

    const results = await Promise.all([
      iterator.next(),
      iterator.next(),
      iterator.next(),
      iterator.next(),
      iterator.next(),
    ])

    expect(results).toEqual([
      { done: false, value: 1 },
      { done: false, value: 2 },
      { done: false, value: 3 },
      { done: true, value: undefined },
      { done: true, value: undefined },
    ])
    await monitoringPromise
    expect(monitored).toEqual([1, 2, 3])
    expect(sourceNext).toHaveBeenCalledTimes(4)
  })

  test('settles every concurrent next call when the source stream is empty', async () => {
    const controller = new AbortController()
    const removeAbortListener = jest.spyOn(controller.signal, 'removeEventListener')
    const sourceNext = jest.fn().mockResolvedValue({ done: true, value: undefined })
    const source = createTestStream<number>(() => ({ next: sourceNext }), controller)
    const [monitoringStream, wrapped] = monitoredStreamTee(source, createTestStream)
    const monitoringPromise = (async () => {
      for await (const _item of monitoringStream) {
        // The source is empty.
      }
    })()
    const iterator = wrapped[Symbol.asyncIterator]()

    await expect(Promise.all([iterator.next(), iterator.next(), iterator.next(), iterator.next()])).resolves.toEqual([
      { done: true, value: undefined },
      { done: true, value: undefined },
      { done: true, value: undefined },
      { done: true, value: undefined },
    ])
    await monitoringPromise
    expect(sourceNext).toHaveBeenCalledTimes(1)
    expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  test('rejects every concurrent next call when the source stream errors', async () => {
    const sourceError = new Error('source failed')
    const sourceNext = jest.fn().mockRejectedValue(sourceError)
    const source = createTestStream<number>(() => ({ next: sourceNext }), new AbortController())
    const [monitoringStream, wrapped] = monitoredStreamTee(source, createTestStream)
    const monitoringPromise = (async () => {
      try {
        for await (const _item of monitoringStream) {
          // The source errors before yielding.
        }
      } catch (error: unknown) {
        return error
      }
      return undefined
    })()
    const iterator = wrapped[Symbol.asyncIterator]()
    const pending = [iterator.next(), iterator.next(), iterator.next(), iterator.next()]

    await Promise.all(pending.map((result) => expect(result).rejects.toBe(sourceError)))
    await expect(monitoringPromise).resolves.toBe(sourceError)
    expect(sourceNext).toHaveBeenCalledTimes(1)
  })
})
