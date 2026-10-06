import { isFunction, isObject, isPromise } from '@posthog/core'
import type { PostHog } from '../posthog-core'
import { document, location } from '../utils/globals'
import { patch } from './replay/rrweb-plugins/patch'

type WebMCPExecute = (this: unknown, ...args: unknown[]) => unknown

interface WebMCPTool {
    name: string
    description?: string
    execute: WebMCPExecute
}

interface WebMCPModelContext {
    registerTool: (tool: WebMCPTool, ...args: unknown[]) => unknown
}

interface WebMCPInstrumentation {
    instances: Set<PostHog>
}

type WebMCPDocument = Document & { modelContext?: WebMCPModelContext }

const instrumentedModelContexts = new WeakMap<WebMCPModelContext, WebMCPInstrumentation>()

function isErrorResult(value: unknown): boolean {
    try {
        return isObject(value) && value.isError === true
    } catch {
        return false
    }
}

export class WebMCP {
    private _isPatched = false

    constructor(private readonly _instance: PostHog) {}

    initialize(): void {
        this.startIfEnabled()
    }

    startIfEnabled(): void {
        if (!this._instance.config.capture_webmcp || this._isPatched) {
            return
        }

        const modelContext = (document as WebMCPDocument | undefined)?.modelContext
        if (!modelContext || !isFunction(modelContext.registerTool)) {
            return
        }

        const existingInstrumentation = instrumentedModelContexts.get(modelContext)
        if (existingInstrumentation) {
            existingInstrumentation.instances.add(this._instance)
            this._isPatched = true
            return
        }

        const instrumentation: WebMCPInstrumentation = { instances: new Set([this._instance]) }
        const unpatchedRegisterTool = modelContext.registerTool
        const webMCP = this

        patch(modelContext as any, 'registerTool', (originalRegisterTool) => {
            const registerTool = originalRegisterTool as WebMCPModelContext['registerTool']
            return function (this: WebMCPModelContext, tool: WebMCPTool, ...args: unknown[]): unknown {
                let registeredTool = tool
                try {
                    registeredTool = webMCP._wrapTool(tool, instrumentation)
                } catch {
                    return registerTool.call(this, tool, ...args)
                }
                return registerTool.call(this, registeredTool, ...args)
            }
        })

        if (modelContext.registerTool === unpatchedRegisterTool) {
            return
        }
        instrumentedModelContexts.set(modelContext, instrumentation)
        this._isPatched = true
    }

    private _wrapTool(tool: WebMCPTool, instrumentation: WebMCPInstrumentation): WebMCPTool {
        if (!tool || !isFunction(tool.execute)) {
            return tool
        }

        const execute = tool.execute
        const webMCP = this
        const wrappedTool = Object.create(tool) as WebMCPTool

        Object.defineProperty(wrappedTool, 'execute', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: function (this: unknown, ...args: unknown[]): unknown {
                const startedAt = new Date()
                let result: unknown

                try {
                    result = execute.apply(this === wrappedTool ? tool : this, args)
                } catch (error) {
                    webMCP._captureToolCall(instrumentation, wrappedTool, startedAt, true)
                    throw error
                }

                if (isPromise(result)) {
                    return Promise.resolve(result).then(
                        (value) => {
                            webMCP._captureToolCall(instrumentation, wrappedTool, startedAt, isErrorResult(value))
                            return value
                        },
                        (error) => {
                            webMCP._captureToolCall(instrumentation, wrappedTool, startedAt, true)
                            throw error
                        }
                    )
                }

                webMCP._captureToolCall(instrumentation, wrappedTool, startedAt, isErrorResult(result))
                return result
            },
        })
        return wrappedTool
    }

    private _captureToolCall(
        instrumentation: WebMCPInstrumentation,
        tool: WebMCPTool,
        timestamp: Date,
        isError: boolean
    ): void {
        const duration = Date.now() - timestamp.getTime()

        for (const instance of instrumentation.instances) {
            if (!instance.config.capture_webmcp) {
                continue
            }

            try {
                instance.capture(
                    '$mcp_tool_call',
                    {
                        $mcp_source: 'posthog_mcp_analytics',
                        $mcp_interface: 'webmcp',
                        $mcp_tool_name: tool.name,
                        $mcp_resource_name: tool.name,
                        $mcp_tool_description: tool.description,
                        $mcp_server_name: location?.hostname,
                        $mcp_duration_ms: duration,
                        $mcp_is_error: isError,
                    },
                    { timestamp }
                )
            } catch {
                continue
            }
        }
    }
}
