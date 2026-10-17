import { EventEmitter } from 'node:events'
import { Observable, defer, lastValueFrom } from 'rxjs'
import { context, trace, ROOT_CONTEXT } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { PostHog } from '@/entrypoints/index.node'
import { PostHogInterceptor } from '@/extensions/nestjs'
import { PostHogContextSpanProcessor } from '@/entrypoints/otel'

describe('NestJS span context', () => {
  const manager = new AsyncLocalStorageContextManager()
  let client: PostHog
  let provider: BasicTracerProvider
  let exporter: InMemorySpanExporter

  beforeAll(() => context.setGlobalContextManager(manager.enable()))
  afterAll(() => {
    context.disable()
    manager.disable()
  })
  beforeEach(() => {
    vi.useRealTimers()
    client = new PostHog('phc_test')
    exporter = new InMemorySpanExporter()
    provider = new BasicTracerProvider({
      spanProcessors: [new PostHogContextSpanProcessor(client), new SimpleSpanProcessor(exporter)],
    })
  })
  afterEach(async () => {
    await provider.shutdown()
    await client.shutdown()
  })

  function requestContext(response: object): any {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-posthog-session-id': 'browser-session', 'x-posthog-distinct-id': 'header-user' },
        }),
        getResponse: () => response,
      }),
    }
  }

  it.each([
    ['express', 'success', 'finish'],
    ['express', 'error', 'close'],
    ['fastify', 'success', 'finish'],
    ['fastify', 'error', 'close'],
  ])('keeps %s %s context until response %s', async (adapter, outcome, event) => {
    const response = new EventEmitter()
    const tracer = provider.getTracer('nestjs-test')
    const incoming = tracer.startSpan('incoming', { attributes: { posthogDistinctId: 'application-user' } })
    let releasePending!: () => void
    let releaseLate!: () => void
    let pending!: Promise<void>
    let late!: Promise<void>
    await context.with(trace.setSpan(ROOT_CONTEXT, incoming), () =>
      client.withContext({ properties: { application: true } }, async () => {
        const interceptor = new PostHogInterceptor(client)
        const result = lastValueFrom(
          interceptor.intercept(requestContext(adapter === 'fastify' ? { raw: response } : response), {
            handle: () =>
              defer(async () => {
                const child = tracer.startSpan('child')
                pending = (async () => {
                  await new Promise<void>((resolve) => {
                    releasePending = resolve
                  })
                  tracer.startSpan('pending-response').end()
                })()
                late = (async () => {
                  await new Promise<void>((resolve) => {
                    releaseLate = resolve
                  })
                  tracer.startSpan('late').end()
                  expect(client.getContext()).toBeUndefined()
                  child.end()
                })()
                if (outcome === 'error') throw new Error('request failure')
                return 'ok'
              }),
          })
        )
        if (outcome === 'error') await expect(result).rejects.toThrow('request failure')
        else expect(await result).toBe('ok')
        releasePending()
        await pending
        response.emit(event)
        releaseLate()
        await late
      })
    )
    incoming.end()
    await provider.forceFlush()
    const spans = exporter.getFinishedSpans()
    for (const name of ['child', 'pending-response']) {
      expect(spans.find((span) => span.name === name)?.attributes).toEqual({
        sessionId: 'browser-session',
        posthogDistinctId: 'header-user',
      })
    }
    expect(spans.find((span) => span.name === 'incoming')?.attributes).toEqual({
      sessionId: 'browser-session',
      posthogDistinctId: 'application-user',
    })
    expect(spans.find((span) => span.name === 'late')?.attributes).toEqual({})
    expect(response.listenerCount('finish')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
  })

  it.each(['throw', 'error', 'unsubscribe'])('expires unsupported-response scope on %s', async (outcome) => {
    const tracer = provider.getTracer('nestjs-test')
    let release!: () => void
    let late!: Promise<void>
    const begin = (): void => {
      late = (async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        tracer.startSpan('late').end()
        expect(client.getContext()).toBeUndefined()
      })()
    }
    const interceptor = new PostHogInterceptor(client)
    const stream = interceptor.intercept(requestContext({}), {
      handle: () => {
        if (outcome === 'throw') {
          begin()
          throw new Error('request failure')
        }
        return new Observable((subscriber) => {
          begin()
          if (outcome === 'error') subscriber.error(new Error('request failure'))
        })
      },
    })
    if (outcome === 'unsubscribe') stream.subscribe().unsubscribe()
    else await expect(lastValueFrom(stream)).rejects.toThrow('request failure')
    release()
    await late
    await provider.forceFlush()
    expect(exporter.getFinishedSpans().find((span) => span.name === 'late')?.attributes).toEqual({})
  })
})
