// @vitest-environment node
import { AsyncLocalStorage } from 'node:async_hooks'
import { context, trace, ROOT_CONTEXT, SpanKind, type Attributes } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { PostHog, type IPostHog } from 'posthog-node'
import { cookies, headers } from 'next/headers.js'
import { createPostHog } from '../src/server/createPostHog.js'
import { createPostHogSpanContext } from '../src/otel.js'

const { cachedClient } = vi.hoisted(() => ({ cachedClient: vi.fn() }))
vi.mock('../src/server/clientCache.node.js', () => ({ getOrCreateNodeClient: cachedClient }))
vi.mock('next/headers.js', () => ({ cookies: vi.fn(), headers: vi.fn() }))

describe('Next.js optional span context', () => {
    const manager = new AsyncLocalStorageContextManager()
    const requests = new AsyncLocalStorage<{ headers: Headers; consent?: string }>()
    let client: PostHog
    let provider: BasicTracerProvider
    let exporter: InMemorySpanExporter
    const config = { apiKey: 'phc_test', options: { host: 'https://example.com' } }

    beforeAll(() => context.setGlobalContextManager(manager.enable()))
    afterAll(() => {
        context.disable()
        manager.disable()
    })
    beforeEach(() => {
        client = new PostHog('phc_test', {
            disableCompression: true,
            fetch: async () => ({ status: 200, text: async () => '{}', json: async () => ({}) }),
        })
        cachedClient.mockResolvedValue(client)
        const defaultHeaders = new Headers({
            'x-posthog-session-id': 'header-session',
            'x-posthog-distinct-id': 'header-person',
        })
        vi.mocked(headers).mockImplementation(async () => (requests.getStore()?.headers ?? defaultHeaders) as any)
        vi.mocked(cookies).mockImplementation(
            async () =>
                ({
                    get: (name: string) =>
                        name === '__ph_opt_in_out_phc_test' && requests.getStore()?.consent
                            ? { value: requests.getStore()?.consent }
                            : undefined,
                }) as any
        )
        exporter = new InMemorySpanExporter()
    })
    afterEach(async () => {
        await provider?.shutdown()
        await client.shutdown()
    })

    async function setup(overrides = {}) {
        const bridge = createPostHogSpanContext({ ...config, ...overrides })
        provider = new BasicTracerProvider({
            spanProcessors: [await bridge.createContextSpanProcessor(), new SimpleSpanProcessor(exporter)],
        })
        return { bridge, tracer: provider.getTracer('next-test') }
    }

    it.each([{}, { sessionId: 'explicit-session', posthogDistinctId: 'explicit-person' }])(
        'enriches the nearest server ancestor and preserves %j',
        async (attributes: Attributes) => {
            const { bridge, tracer } = await setup()
            const outer = tracer.startSpan('outer', { kind: SpanKind.SERVER })
            await context.with(trace.setSpan(ROOT_CONTEXT, outer), async () => {
                await tracer.startActiveSpan('nearest', { kind: SpanKind.SERVER, attributes }, async (server) => {
                    await tracer.startActiveSpan('inner', async (inner) => {
                        await bridge.withPostHogContext(async () => {
                            await Promise.resolve()
                            tracer.startSpan('child').end()
                        })
                        inner.end()
                    })
                    server.end()
                })
            })
            outer.end()
            await provider.forceFlush()
            const spans = exporter.getFinishedSpans()
            expect(spans.find((span) => span.name === 'nearest')?.attributes).toEqual({
                sessionId: 'header-session',
                posthogDistinctId: 'header-person',
                ...attributes,
            })
            expect(spans.find((span) => span.name === 'outer')?.attributes).toEqual({})
            expect(spans.find((span) => span.name === 'child')?.attributes).toEqual({
                sessionId: 'header-session',
                posthogDistinctId: 'header-person',
            })
        }
    )

    it('uses the configured cached client at startup without reading a request', async () => {
        const getDistinctId = vi.fn(() => 'trusted-person')
        const { bridge } = await setup({ getDistinctId })
        expect(cookies).not.toHaveBeenCalled()
        expect(headers).not.toHaveBeenCalled()
        expect(getDistinctId).not.toHaveBeenCalled()
        const scoped = await createPostHog({ ...config, getDistinctId }).getPostHog()
        expect(scoped.getContext()?.distinctId).toBe('trusted-person')
        await bridge.withPostHogContext((requestClient) =>
            expect(requestClient.getContext()?.distinctId).toBe('trusted-person')
        )
        expect(getDistinctId).toHaveBeenCalledTimes(1)
        expect(cachedClient).toHaveBeenLastCalledWith(config.apiKey, config.options)
    })

    it.each(['success', 'failure'])('expires captured client calls and async SDK work after %s', async (outcome) => {
        const { bridge, tracer } = await setup()
        let retained!: IPostHog
        let release!: () => void
        let work!: Promise<void>
        const result = bridge.withPostHogContext((requestClient) => {
            retained = requestClient
            work = requestClient.withSpan('job', async () => {
                await new Promise<void>((resolve) => {
                    release = resolve
                })
                tracer.startSpan('late-work').end()
            })
            if (outcome === 'failure') throw new Error('request failure')
            return 'ok'
        })
        if (outcome === 'failure') await expect(result).rejects.toThrow('request failure')
        else expect(await result).toBe('ok')
        expect(retained.getContext()).toBeUndefined()
        retained.withSpan('late-client', () => tracer.startSpan('late-client-work').end())
        release()
        await work
        await provider.forceFlush()
        expect(exporter.getFinishedSpans().map((span) => span.attributes)).toEqual([{}, {}])
        expect(client.getContext()).toBeUndefined()
    })

    it.each(['0', '1'])('keeps consent=%s identity and resolver behavior', async (consent) => {
        const getDistinctId = vi.fn(() => 'trusted-person')
        const { bridge, tracer } = await setup({ getDistinctId })
        await requests.run(
            {
                headers: new Headers({
                    'x-posthog-session-id': 'request-session',
                    'x-posthog-distinct-id': 'request-person',
                }),
                consent,
            },
            () =>
                bridge.withPostHogContext((requestClient) => {
                    expect(requestClient.getContext()?.distinctId).toBe(consent === '0' ? undefined : 'trusted-person')
                    tracer.startSpan('child').end()
                })
        )
        await provider.forceFlush()
        expect(exporter.getFinishedSpans()[0].attributes).toEqual(
            consent === '0' ? {} : { sessionId: 'request-session', posthogDistinctId: 'trusted-person' }
        )
        expect(getDistinctId).toHaveBeenCalledTimes(consent === '0' ? 0 : 1)
    })

    it.each(['ordinary', 'redirect'])('preserves resolver %s errors', async (kind) => {
        const error = Object.assign(
            new Error('resolver failure'),
            kind === 'redirect' ? { digest: 'NEXT_REDIRECT;replace;/example;307;' } : {}
        )
        const { bridge } = await setup({
            getDistinctId: () => {
                throw error
            },
        })
        const run = bridge.withPostHogContext((requestClient) => requestClient.getContext()?.distinctId)
        if (kind === 'redirect') await expect(run).rejects.toBe(error)
        else expect(await run).toBe('header-person')
        expect(client.getContext()).toBeUndefined()
    })

    it('isolates concurrent requests through awaited work', async () => {
        const { bridge, tracer } = await setup()
        await Promise.all(
            ['first', 'second'].map((id) =>
                requests.run({ headers: new Headers({ 'x-posthog-session-id': id }) }, () =>
                    bridge.withPostHogContext(async () => {
                        await Promise.resolve()
                        tracer.startSpan(id).end()
                    })
                )
            )
        )
        await provider.forceFlush()
        expect(exporter.getFinishedSpans().map((span) => span.attributes)).toEqual(
            expect.arrayContaining([{ sessionId: 'first' }, { sessionId: 'second' }])
        )
    })
})
