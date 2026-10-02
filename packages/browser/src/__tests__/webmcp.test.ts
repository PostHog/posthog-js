import { WebMCP } from '../extensions/webmcp'
import { PostHog } from '../posthog-core'
import { createMockPostHog } from './helpers/posthog-instance'

type Tool = {
    name: string
    description?: string
    inputSchema?: Record<string, any>
    execute: (...args: unknown[]) => unknown
}

describe('WebMCP', () => {
    let registerTool: ReturnType<typeof vi.fn>

    beforeEach(() => {
        registerTool = vi.fn(() => 'registration-result')
        Object.defineProperty(document, 'modelContext', {
            configurable: true,
            value: { registerTool },
        })
    })

    afterEach(() => {
        Reflect.deleteProperty(document, 'modelContext')
        vi.restoreAllMocks()
    })

    const register = (webMCP: WebMCP, tool: Tool, options?: unknown): unknown => {
        webMCP.initialize()
        return (document as any).modelContext.registerTool(tool, options)
    }

    const registeredTool = (index: number): Tool => registerTool.mock.calls[index][0] as Tool

    it('captures synchronous and asynchronous tool calls with the MCP Analytics contract', async () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const webMCP = new WebMCP(posthog)
        const syncResult = { content: [{ type: 'text', text: 'sync' }] }
        const asyncResult = { content: [{ type: 'text', text: 'async' }] }
        const syncTool = { name: 'sync_tool', description: 'Runs now.', execute: vi.fn(() => syncResult) }
        const asyncTool = { name: 'async_tool', description: 'Runs later.', execute: vi.fn(async () => asyncResult) }
        const options = { signal: new AbortController().signal }

        expect(register(webMCP, syncTool, options)).toBe('registration-result')
        register(webMCP, asyncTool)
        expect(registerTool).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ name: syncTool.name, description: syncTool.description }),
            options
        )

        expect(registeredTool(0).execute('input')).toBe(syncResult)
        await expect(registeredTool(1).execute('input')).resolves.toBe(asyncResult)
        expect(syncTool.execute).toHaveBeenCalledWith('input')
        expect(asyncTool.execute).toHaveBeenCalledWith('input')

        expect(posthog.capture).toHaveBeenCalledTimes(2)
        expect(posthog.capture).toHaveBeenNthCalledWith(
            1,
            '$mcp_tool_call',
            expect.objectContaining({
                $mcp_source: 'posthog_mcp_analytics',
                $mcp_interface: 'webmcp',
                $mcp_tool_name: 'sync_tool',
                $mcp_resource_name: 'sync_tool',
                $mcp_tool_description: 'Runs now.',
                $mcp_server_name: 'localhost',
                $mcp_duration_ms: expect.any(Number),
                $mcp_is_error: false,
            }),
            { timestamp: expect.any(Date) }
        )
    })

    it('injects and captures intent and model metadata without mutating the tool', () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const webMCP = new WebMCP(posthog)
        const inputSchema = {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
        }
        const result = { content: [] }
        const execute = vi.fn(() => result)
        const tool = { name: 'search', inputSchema, execute }
        const options = { signal: new AbortController().signal }

        register(webMCP, tool)
        const wrappedTool = registeredTool(0)

        expect(wrappedTool.inputSchema).toEqual({
            type: 'object',
            properties: {
                query: { type: 'string' },
                context: expect.objectContaining({ type: 'string' }),
                llm_model: expect.objectContaining({ type: 'string' }),
            },
            required: ['query', 'context', 'llm_model'],
        })
        expect(tool.inputSchema).toBe(inputSchema)
        expect(inputSchema).toEqual({
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
        })

        expect(
            wrappedTool.execute(
                { query: 'flags', context: '  Find the feature flag documentation.  ', llm_model: '  gpt-5.2  ' },
                options
            )
        ).toBe(result)
        expect(execute).toHaveBeenCalledWith({ query: 'flags' }, options)
        expect(posthog.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.objectContaining({
                $mcp_intent: 'Find the feature flag documentation.',
                $mcp_intent_source: 'context_parameter',
                $mcp_llm_model: 'gpt-5.2',
                $mcp_llm_model_source: 'self_reported',
            }),
            expect.any(Object)
        )
    })

    it.each([
        [{ intent: false }, 'context', 'llm_model', '$mcp_llm_model'],
        [{ model: false }, 'llm_model', 'context', '$mcp_intent'],
    ])('supports metadata opt-outs with %o', (config, omittedParameter, injectedParameter, capturedProperty) => {
        const posthog = createMockPostHog({ config: { capture_webmcp: config } as any })
        const execute = vi.fn(() => ({ content: [] }))

        register(new WebMCP(posthog), { name: 'configured', inputSchema: { type: 'object' }, execute })
        const tool = registeredTool(0)
        expect(tool.inputSchema).not.toHaveProperty(`properties.${omittedParameter}`)
        expect(tool.inputSchema).toHaveProperty(`properties.${injectedParameter}`)

        tool.execute({ [injectedParameter]: injectedParameter === 'context' ? 'Investigate an issue.' : 'gpt-5' })
        expect(execute).toHaveBeenCalledWith({})
        expect(posthog.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.objectContaining({ [capturedProperty]: expect.any(String) }),
            expect.any(Object)
        )
    })

    it('preserves application-owned context and model fields', () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const execute = vi.fn(() => ({ content: [] }))
        const inputSchema = {
            type: 'object',
            properties: {
                context: { type: 'string', description: 'Application context.' },
                llm_model: { type: 'string', description: 'Routing model.' },
            },
            required: ['context', 'llm_model'],
        }
        const input = { context: 'application-value', llm_model: 'application-model' }

        register(new WebMCP(posthog), { name: 'application_owned', inputSchema, execute })
        registeredTool(0).execute(input)

        expect(registeredTool(0).inputSchema).toBe(inputSchema)
        expect(execute).toHaveBeenCalledWith(input)
        expect(posthog.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.not.objectContaining({
                $mcp_intent: expect.anything(),
                $mcp_llm_model: expect.anything(),
            }),
            expect.any(Object)
        )
    })

    it.each([true, { type: 'string' }])(
        'preserves undeclared application inputs when additionalProperties is %o',
        (additionalProperties) => {
            const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
            const execute = vi.fn(() => ({ content: [] }))
            const inputSchema = { type: 'object', additionalProperties }
            const input = { context: 'application-value', llm_model: 'application-model' }

            register(new WebMCP(posthog), { name: 'permissive', inputSchema, execute })
            registeredTool(0).execute(input)

            expect(registeredTool(0).inputSchema).toBe(inputSchema)
            expect(execute).toHaveBeenCalledWith(input)
            expect(vi.mocked(posthog.capture).mock.calls[0][1]).toEqual(
                expect.not.objectContaining({
                    $mcp_intent: expect.anything(),
                    $mcp_llm_model: expect.anything(),
                })
            )
        }
    )

    it('does not inject metadata into a complex schema', () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const execute = vi.fn(() => ({ content: [] }))
        const inputSchema = { $ref: '#/$defs/input' }
        const input = { context: 'application-value', llm_model: 'application-model' }

        register(new WebMCP(posthog), { name: 'complex', inputSchema, execute })
        registeredTool(0).execute(input)

        expect(registeredTool(0).inputSchema).toBe(inputSchema)
        expect(execute).toHaveBeenCalledWith(input)
        expect(vi.mocked(posthog.capture).mock.calls[0][1]).toEqual(
            expect.not.objectContaining({
                $mcp_intent: expect.anything(),
                $mcp_llm_model: expect.anything(),
            })
        )
    })

    it('injects the union of named instance options and filters each event', () => {
        const intentInstance = createMockPostHog({
            config: { capture_webmcp: { intent: true, model: false } } as any,
        })
        const modelInstance = createMockPostHog({
            config: { capture_webmcp: { intent: false, model: true } } as any,
        })
        const intentWebMCP = new WebMCP(intentInstance)
        const modelWebMCP = new WebMCP(modelInstance)
        const execute = vi.fn(() => ({ content: [] }))

        intentWebMCP.initialize()
        modelWebMCP.initialize()
        register(intentWebMCP, { name: 'named', inputSchema: { type: 'object' }, execute })
        registeredTool(0).execute({ context: 'Find documentation.', llm_model: 'claude-sonnet-4' })

        expect(execute).toHaveBeenCalledWith({})
        expect(intentInstance.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.objectContaining({ $mcp_intent: 'Find documentation.' }),
            expect.any(Object)
        )
        expect(intentInstance.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.not.objectContaining({ $mcp_llm_model: expect.anything() }),
            expect.any(Object)
        )
        expect(modelInstance.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.objectContaining({ $mcp_llm_model: 'claude-sonnet-4' }),
            expect.any(Object)
        )
        expect(modelInstance.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.not.objectContaining({ $mcp_intent: expect.anything() }),
            expect.any(Object)
        )
    })

    it('limits metadata and omits blank intent and unknown models', () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const webMCP = new WebMCP(posthog)

        register(webMCP, { name: 'bounded', inputSchema: { type: 'object' }, execute: () => ({ content: [] }) })
        registeredTool(0).execute({ context: ` ${'i'.repeat(2100)} `, llm_model: ` ${'m'.repeat(300)} ` })
        registeredTool(0).execute({ context: ' {} ', llm_model: ' UNKNOWN ' })

        expect(vi.mocked(posthog.capture).mock.calls[0][1]).toEqual(
            expect.objectContaining({
                $mcp_intent: 'i'.repeat(2048),
                $mcp_llm_model: 'm'.repeat(256),
            })
        )
        expect(vi.mocked(posthog.capture).mock.calls[1][1]).toEqual(
            expect.not.objectContaining({
                $mcp_intent: expect.anything(),
                $mcp_llm_model: expect.anything(),
            })
        )
    })

    it('redacts structured identifiers from intent', () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })

        register(new WebMCP(posthog), {
            name: 'private',
            inputSchema: { type: 'object' },
            execute: () => ({ content: [] }),
        })
        registeredTool(0).execute({
            context:
                'Contact alice@example.com from 192.168.1.1 or 2001:db8::1 using 4111 1111 1111 1111, SSN 123-45-6789, or +1-202-555-0170.',
            llm_model: 'gpt-5',
        })

        expect(vi.mocked(posthog.capture).mock.calls[0][1]).toEqual(
            expect.objectContaining({
                $mcp_intent:
                    'Contact [redacted] from [redacted] or [redacted] using [redacted], SSN [redacted], or [redacted].',
            })
        )
    })

    it('preserves error results, synchronous throws, and promise rejections', async () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const webMCP = new WebMCP(posthog)
        const errorResult = { isError: true, content: [] }
        const thrown = new Error('sync failure')
        const rejected = new Error('async failure')
        const resultTool = { name: 'error_result', execute: () => errorResult }
        const throwTool = {
            name: 'throw',
            execute: vi.fn(() => {
                throw thrown
            }),
        }
        const rejectTool = {
            name: 'reject',
            execute: vi.fn(async () => {
                throw rejected
            }),
        }

        register(webMCP, resultTool)
        register(webMCP, throwTool)
        register(webMCP, rejectTool)
        expect(registeredTool(0).execute()).toBe(errorResult)
        expect(() => registeredTool(1).execute()).toThrow(thrown)
        await expect(registeredTool(2).execute()).rejects.toBe(rejected)

        expect(posthog.capture).toHaveBeenCalledTimes(3)
        for (const call of vi.mocked(posthog.capture).mock.calls) {
            expect(call[1]).toEqual(expect.objectContaining({ $mcp_is_error: true }))
        }
    })

    it('captures one event when an aborted call settles later', async () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const webMCP = new WebMCP(posthog)
        const controller = new AbortController()
        let resolve: (value: unknown) => void = () => undefined
        const pending = new Promise((done) => {
            resolve = done
        })
        const tool = { name: 'slow', execute: () => pending }

        register(webMCP, tool, { signal: controller.signal })
        const call = registeredTool(0).execute()
        controller.abort()
        resolve({ content: [] })
        await call

        expect(posthog.capture).toHaveBeenCalledTimes(1)
    })

    it('does not patch or capture until enabled through set_config', () => {
        const posthog = new PostHog()
        posthog.config.capture_webmcp = false
        posthog.webMCP = new WebMCP(posthog)
        posthog.webMCP.initialize()

        expect((document as any).modelContext.registerTool).toBe(registerTool)

        posthog.set_config({ capture_webmcp: true })
        expect((document as any).modelContext.registerTool).not.toBe(registerTool)
    })

    it('captures to each enabled named instance through one patch', () => {
        const first = createMockPostHog({ config: { capture_webmcp: true } as any })
        const second = createMockPostHog({ config: { capture_webmcp: true } as any })
        const firstWebMCP = new WebMCP(first)
        const secondWebMCP = new WebMCP(second)

        firstWebMCP.initialize()
        const patchedRegisterTool = (document as any).modelContext.registerTool
        secondWebMCP.initialize()
        expect((document as any).modelContext.registerTool).toBe(patchedRegisterTool)

        register(firstWebMCP, { name: 'named', execute: () => ({ content: [] }) })
        registeredTool(0).execute()

        expect(first.capture).toHaveBeenCalledTimes(1)
        expect(second.capture).toHaveBeenCalledTimes(1)

        second.config.capture_webmcp = false
        registeredTool(0).execute()
        expect(first.capture).toHaveBeenCalledTimes(2)
        expect(second.capture).toHaveBeenCalledTimes(1)
    })

    it('does not change tool behavior when capture throws', () => {
        const result = { content: [] }
        const posthog = createMockPostHog({
            config: { capture_webmcp: true } as any,
            capture: vi.fn(() => {
                throw new Error('capture failure')
            }),
        })
        const tool = { name: 'safe', execute: () => result }

        register(new WebMCP(posthog), tool)

        expect(registeredTool(0).execute()).toBe(result)
    })

    it('does not mutate frozen tools or tools from failed registrations', async () => {
        const failure = new Error('registration failure')
        registerTool.mockRejectedValue(failure)
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const execute = vi.fn(() => ({ content: [] }))
        const tool = Object.freeze({ name: 'frozen', execute })

        await expect(register(new WebMCP(posthog), tool)).rejects.toBe(failure)
        expect(tool.execute).toBe(execute)
        expect(tool.execute()).toEqual({ content: [] })
        expect(posthog.capture).not.toHaveBeenCalled()
    })

    it('does not let a throwing isError accessor change the tool result', async () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const webMCP = new WebMCP(posthog)
        const throwingIsError = {}
        Object.defineProperty(throwingIsError, 'isError', {
            get: () => {
                throw new Error('isError getter failure')
            },
        })

        register(webMCP, { name: 'is_error', execute: async () => throwingIsError })

        await expect(registeredTool(0).execute()).resolves.toBe(throwingIsError)
        expect(posthog.capture).toHaveBeenCalledTimes(1)
        expect(posthog.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.objectContaining({ $mcp_is_error: false }),
            expect.any(Object)
        )
    })

    it('captures a thenable whose then method throws', async () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const failure = new Error('then failure')
        const thenable = {
            then: () => {
                throw failure
            },
        }

        register(new WebMCP(posthog), { name: 'throwing_then', execute: () => thenable })

        await expect(registeredTool(0).execute()).rejects.toBe(failure)
        expect(posthog.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.objectContaining({ $mcp_is_error: true }),
            expect.any(Object)
        )
    })
})
