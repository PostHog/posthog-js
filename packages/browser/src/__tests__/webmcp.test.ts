import { WebMCP } from '../extensions/webmcp'
import { PostHog } from '../posthog-core'
import { createMockPostHog } from './helpers/posthog-instance'

type Tool = {
    name: string
    description?: string
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

    it('does not let throwing result accessors change the tool result', async () => {
        const posthog = createMockPostHog({ config: { capture_webmcp: true } as any })
        const webMCP = new WebMCP(posthog)
        const throwingThen = {}
        Object.defineProperty(throwingThen, 'then', {
            get: () => {
                throw new Error('then getter failure')
            },
        })
        const throwingIsError = {}
        Object.defineProperty(throwingIsError, 'isError', {
            get: () => {
                throw new Error('isError getter failure')
            },
        })

        register(webMCP, { name: 'then', execute: () => throwingThen })
        register(webMCP, { name: 'is_error', execute: async () => throwingIsError })

        expect(registeredTool(0).execute()).toBe(throwingThen)
        await expect(registeredTool(1).execute()).resolves.toBe(throwingIsError)
        expect(posthog.capture).toHaveBeenCalledTimes(2)
        expect(posthog.capture).toHaveBeenNthCalledWith(
            1,
            '$mcp_tool_call',
            expect.objectContaining({ $mcp_is_error: false }),
            expect.any(Object)
        )
        expect(posthog.capture).toHaveBeenNthCalledWith(
            2,
            '$mcp_tool_call',
            expect.objectContaining({ $mcp_is_error: false }),
            expect.any(Object)
        )
    })
})
