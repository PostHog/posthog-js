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
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    const register = (webMCP: WebMCP, tool: Tool, options?: unknown): unknown => {
        webMCP.initialize()
        return (document as any).modelContext.registerTool(tool, options)
    }

    const registeredTool = (index: number): Tool => registerTool.mock.calls[index][0] as Tool

    const capturedProperties = (posthog: PostHog, index = 0): Record<string, unknown> =>
        vi.mocked(posthog.capture).mock.calls[index][1] as Record<string, unknown>

    const expectNoMetadata = (properties: Record<string, unknown>): void => {
        for (const property of ['$mcp_intent', '$mcp_intent_source', '$mcp_llm_model', '$mcp_llm_model_source']) {
            expect(properties).not.toHaveProperty(property)
        }
    }

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
        {
            config: { intent: false },
            disabled: { parameter: 'context', property: '$mcp_intent', value: 'Investigate an issue.' },
            enabled: { parameter: 'llm_model', property: '$mcp_llm_model', value: 'gpt-5' },
        },
        {
            config: { model: false },
            disabled: { parameter: 'llm_model', property: '$mcp_llm_model', value: 'gpt-5' },
            enabled: { parameter: 'context', property: '$mcp_intent', value: 'Investigate an issue.' },
        },
    ])('supports metadata opt-outs with %o', ({ config, disabled, enabled }) => {
        const posthog = createMockPostHog({ config: { capture_webmcp: config } as any })
        const execute = vi.fn(() => ({ content: [] }))

        register(new WebMCP(posthog), { name: 'configured', inputSchema: { type: 'object' }, execute })
        const tool = registeredTool(0)
        expect(tool.inputSchema).not.toHaveProperty(`properties.${disabled.parameter}`)
        expect(tool.inputSchema).toHaveProperty(`properties.${enabled.parameter}`)

        tool.execute({ [disabled.parameter]: disabled.value, [enabled.parameter]: enabled.value })

        expect(execute).toHaveBeenCalledWith({ [disabled.parameter]: disabled.value })
        expect(capturedProperties(posthog)).toHaveProperty(enabled.property, enabled.value)
        expect(capturedProperties(posthog)).not.toHaveProperty(disabled.property)
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
        expectNoMetadata(capturedProperties(posthog))
    })

    it.each([
        ['additionalProperties omitted', { type: 'object' }],
        ['additionalProperties true', { type: 'object', additionalProperties: true }],
        ['additionalProperties false', { type: 'object', additionalProperties: false }],
        ['annotations', { type: 'object', title: 'x', default: {}, examples: [{}], $comment: 'x', 'x-vendor': 1 }],
        ['definitions', { type: 'object', $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: {} }],
        ['other required fields', { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }],
    ])('injects metadata into a schema with %s', (_label, inputSchema) => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const execute = vi.fn(() => ({ content: [] }))

        register(new WebMCP(posthog), { name: 'open', inputSchema, execute })
        registeredTool(0).execute({ context: 'Find documentation.', llm_model: 'gpt-5', query: 'flags' })

        expect(registeredTool(0).inputSchema).toHaveProperty('properties.context')
        expect(registeredTool(0).inputSchema).toHaveProperty('properties.llm_model')
        expect(execute).toHaveBeenCalledWith({ query: 'flags' })
        expect(capturedProperties(posthog)).toHaveProperty('$mcp_intent', 'Find documentation.')
        expect(capturedProperties(posthog)).toHaveProperty('$mcp_llm_model', 'gpt-5')
    })

    it.each([
        ['$ref', { $ref: '#/$defs/input' }],
        ['oneOf', { oneOf: [{ type: 'object' }] }],
        ['anyOf', { anyOf: [{ type: 'object' }] }],
        ['allOf', { allOf: [{ type: 'object' }] }],
        ['not', { type: 'object', not: { required: ['x'] } }],
        ['if', { type: 'object', if: { required: ['x'] }, then: {} }],
        ['propertyNames', { type: 'object', propertyNames: { pattern: '^[a-z]+$' } }],
        ['maxProperties', { type: 'object', maxProperties: 1 }],
        ['unevaluatedProperties', { type: 'object', unevaluatedProperties: false }],
        ['patternProperties', { type: 'object', patternProperties: { '^x-': {} } }],
        ['dependentSchemas', { type: 'object', dependentSchemas: { a: {} } }],
        ['a schema for additionalProperties', { type: 'object', additionalProperties: { type: 'string' } }],
        ['a non-object type', { type: 'array' }],
        ['properties that is not an object', { type: 'object', properties: [] }],
        ['required that is not an array', { type: 'object', required: 'query' }],
    ])('does not inject metadata into a schema with %s', (_label, inputSchema) => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const execute = vi.fn(() => ({ content: [] }))
        const input = { context: 'application-value', llm_model: 'application-model' }

        register(new WebMCP(posthog), { name: 'constrained', inputSchema, execute })
        registeredTool(0).execute(input)

        expect(registeredTool(0).inputSchema).toBe(inputSchema)
        expect(execute).toHaveBeenCalledWith(input)
        expectNoMetadata(capturedProperties(posthog))
    })

    it('treats a required context field as owned by the application', () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: { model: false } } as any })
        const execute = vi.fn(() => ({ content: [] }))
        const inputSchema = { type: 'object', required: ['context'] }
        const input = { context: 'application-value' }

        register(new WebMCP(posthog), { name: 'required_context', inputSchema, execute })
        registeredTool(0).execute(input)

        expect(registeredTool(0).inputSchema).toBe(inputSchema)
        expect(execute).toHaveBeenCalledWith(input)
        expectNoMetadata(capturedProperties(posthog))
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
        expect(capturedProperties(intentInstance)).not.toHaveProperty('$mcp_llm_model')
        expect(capturedProperties(intentInstance)).not.toHaveProperty('$mcp_llm_model_source')
        expect(modelInstance.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.objectContaining({ $mcp_llm_model: 'claude-sonnet-4' }),
            expect.any(Object)
        )
        expect(capturedProperties(modelInstance)).not.toHaveProperty('$mcp_intent')
        expect(capturedProperties(modelInstance)).not.toHaveProperty('$mcp_intent_source')
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
        expectNoMetadata(capturedProperties(posthog, 1))
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

    it('redacts credentials from URLs in intent', () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })

        register(new WebMCP(posthog), {
            name: 'private_url',
            inputSchema: { type: 'object' },
            execute: () => ({ content: [] }),
        })
        registeredTool(0).execute({
            context: 'Open https://example.com/report?token=sk_live_example&view=summary.',
            llm_model: 'gpt-5',
        })

        expect(vi.mocked(posthog.capture).mock.calls[0][1]).toEqual(
            expect.objectContaining({
                $mcp_intent: 'Open https://example.com/report?token=%5Bredacted%5D&view=summary.',
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

    it('captures the time the tool took to run', () => {
        vi.useFakeTimers()
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const tool = {
            name: 'slow',
            execute: () => {
                vi.advanceTimersByTime(25)
                return { content: [] }
            },
        }

        register(new WebMCP(posthog), tool)
        registeredTool(0).execute()

        expect(capturedProperties(posthog)).toHaveProperty('$mcp_duration_ms', 25)
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

    it('preserves inherited fields and the receiver for class tools', () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const result = { content: [] }

        class ClassTool {
            calls = 0

            get name(): string {
                return 'class_tool'
            }

            get inputSchema(): object {
                return { type: 'object' }
            }

            execute(): unknown {
                this.calls++
                return result
            }
        }

        const tool = new ClassTool()
        register(new WebMCP(posthog), tool)

        expect(registeredTool(0).name).toBe('class_tool')
        expect((registeredTool(0) as Tool & { inputSchema: object }).inputSchema).toEqual(
            expect.objectContaining({ type: 'object' })
        )
        expect(registeredTool(0).execute()).toBe(result)
        expect(tool.calls).toBe(1)
        expect(posthog.capture).toHaveBeenCalledWith(
            '$mcp_tool_call',
            expect.objectContaining({ $mcp_tool_name: 'class_tool' }),
            expect.any(Object)
        )
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
