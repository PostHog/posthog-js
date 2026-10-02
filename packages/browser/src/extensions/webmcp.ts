import { isFunction, isObject } from '@posthog/core'
import type { PostHog } from '../posthog-core'
import { document, location } from '../utils/globals'

type WebMCPExecute = (this: unknown, ...args: unknown[]) => unknown

interface WebMCPTool {
    name: string
    description?: string
    execute: WebMCPExecute
}

interface WebMCPModelContext {
    registerTool: (tool: WebMCPTool, ...args: unknown[]) => unknown
}

type WebMCPDocument = Document & { modelContext?: WebMCPModelContext }

const wrappedExecutors = new WeakSet<WebMCPExecute>()

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

        const registerTool = modelContext.registerTool
        const webMCP = this

        const patchedRegisterTool = function (this: WebMCPModelContext, tool: WebMCPTool, ...args: unknown[]): unknown {
            try {
                webMCP._wrapTool(tool)
            } catch {
                return registerTool.call(this, tool, ...args)
            }
            return registerTool.call(this, tool, ...args)
        }

        try {
            modelContext.registerTool = patchedRegisterTool
        } catch {
            return
        }
        this._isPatched = true
    }

    private _wrapTool(tool: WebMCPTool): void {
        if (!tool || !isFunction(tool.execute) || wrappedExecutors.has(tool.execute)) {
            return
        }

        const execute = tool.execute
        const webMCP = this

        tool.execute = function (...args): unknown {
            const startedAt = new Date()
            let result: unknown

            try {
                result = execute.apply(this, args)
            } catch (error) {
                webMCP._captureToolCall(tool, startedAt, true)
                throw error
            }

            if (isFunction((result as PromiseLike<unknown> | undefined)?.then)) {
                return Promise.resolve(result).then(
                    (value) => {
                        webMCP._captureToolCall(tool, startedAt, isObject(value) && value.isError === true)
                        return value
                    },
                    (error) => {
                        webMCP._captureToolCall(tool, startedAt, true)
                        throw error
                    }
                )
            }

            webMCP._captureToolCall(tool, startedAt, isObject(result) && result.isError === true)
            return result
        }
        wrappedExecutors.add(tool.execute)
    }

    private _captureToolCall(tool: WebMCPTool, timestamp: Date, isError: boolean): void {
        if (!this._instance.config.capture_webmcp) {
            return
        }

        try {
            this._instance.capture(
                '$mcp_tool_call',
                {
                    $mcp_source: 'posthog_mcp_analytics',
                    $mcp_interface: 'webmcp',
                    $mcp_tool_name: tool.name,
                    $mcp_resource_name: tool.name,
                    $mcp_tool_description: tool.description,
                    $mcp_server_name: location?.hostname,
                    $mcp_duration_ms: Date.now() - timestamp.getTime(),
                    $mcp_is_error: isError,
                },
                { timestamp }
            )
        } catch {
            return
        }
    }
}
