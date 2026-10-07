import { isArray, isFunction, isObject, isPromise, isString, isUndefined, sanitizeFreeText } from '@posthog/core'
import type { WebMCPCaptureConfig } from '@posthog/types'
import type { PostHog } from '../posthog-core'
import { document, location } from '../utils/globals'
import { patch } from './replay/rrweb-plugins/patch'

type WebMCPExecute = (this: unknown, ...args: unknown[]) => unknown

interface WebMCPInputSchema extends Record<string, unknown> {
    properties?: Record<string, unknown>
    required?: unknown[]
    type?: unknown
}

interface WebMCPTool {
    name: string
    description?: string
    inputSchema?: WebMCPInputSchema
    execute: WebMCPExecute
}

interface WebMCPModelContext {
    registerTool: (tool: WebMCPTool, ...args: unknown[]) => unknown
}

interface WebMCPInstrumentation {
    instances: Set<PostHog>
}

interface WebMCPMetadataOptions {
    intent: boolean
    model: boolean
}

interface WebMCPMetadata {
    intent?: string
    model?: string
}

type WebMCPDocument = Document & { modelContext?: WebMCPModelContext }

const instrumentedModelContexts = new WeakMap<WebMCPModelContext, WebMCPInstrumentation>()

const CONTEXT_PARAMETER_DESCRIPTION = `Explain why this tool is called and how it supports the user's goal. Describe the abstract purpose only. Do not include personal or identifying information. Generalize specific entities as roles such as "a customer".`
const MODEL_PARAMETER_DESCRIPTION =
    'The exact model identifier you are running as, taken from your system prompt or environment. Pass "unknown" if you do not know it. Never guess.'
const INJECTABLE_SCHEMA_KEYS = new Set([
    '$comment',
    '$defs',
    '$id',
    '$schema',
    'additionalProperties',
    'default',
    'definitions',
    'deprecated',
    'description',
    'examples',
    'minProperties',
    'properties',
    'readOnly',
    'required',
    'title',
    'type',
    'writeOnly',
])
const MAX_INTENT_LENGTH = 2048
const MAX_MODEL_LENGTH = 256
const INTENT_SANITIZATION_OPTIONS = { maxStringLength: MAX_INTENT_LENGTH, truncationSuffix: '...' }

function getMetadataOptions(config: boolean | WebMCPCaptureConfig | undefined): WebMCPMetadataOptions | undefined {
    if (!config) {
        return undefined
    }
    if (config === true) {
        return { intent: true, model: true }
    }
    return { intent: config.intent !== false, model: config.model !== false }
}

function getRequestedMetadata(instrumentation: WebMCPInstrumentation): WebMCPMetadataOptions {
    const requested = { intent: false, model: false }
    for (const instance of instrumentation.instances) {
        const options = getMetadataOptions(instance.config.capture_webmcp)
        requested.intent ||= options?.intent === true
        requested.model ||= options?.model === true
    }
    return requested
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key)
}

function copyTool(tool: WebMCPTool, inputSchema?: WebMCPInputSchema): WebMCPTool {
    const copiedTool = Object.create(tool) as WebMCPTool
    if (inputSchema) {
        Object.defineProperty(copiedTool, 'inputSchema', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: inputSchema,
        })
    }
    return copiedTool
}

function canInjectInto(schema: WebMCPInputSchema | undefined): boolean {
    if (isUndefined(schema)) {
        return true
    }
    return (
        isObject(schema) &&
        Object.keys(schema).every((key) => INJECTABLE_SCHEMA_KEYS.has(key) || key.startsWith('x-')) &&
        schema.additionalProperties !== true &&
        !isObject(schema.additionalProperties) &&
        (!schema.type || schema.type === 'object') &&
        (!schema.properties || isObject(schema.properties)) &&
        (!schema.required || isArray(schema.required))
    )
}

function injectMetadataParameters(
    tool: WebMCPTool,
    requested: WebMCPMetadataOptions
): { tool: WebMCPTool; injected: WebMCPMetadataOptions } {
    const injected = { intent: false, model: false }
    const schema = tool.inputSchema

    if (!canInjectInto(schema)) {
        return { tool: copyTool(tool), injected }
    }

    const properties = schema?.properties || {}
    const declared = (name: string): boolean =>
        hasOwn(properties, name) || (isArray(schema?.required) && schema.required.includes(name))
    injected.intent = requested.intent && !declared('context')
    injected.model = requested.model && !declared('llm_model')

    if (!injected.intent && !injected.model) {
        return { tool: copyTool(tool), injected }
    }

    const nextProperties = { ...properties }
    const required = isArray(schema?.required) ? [...schema.required] : []

    if (injected.intent) {
        nextProperties.context = { type: 'string', description: CONTEXT_PARAMETER_DESCRIPTION }
        if (!required.includes('context')) {
            required.push('context')
        }
    }
    if (injected.model) {
        nextProperties.llm_model = { type: 'string', description: MODEL_PARAMETER_DESCRIPTION }
        if (!required.includes('llm_model')) {
            required.push('llm_model')
        }
    }

    return {
        tool: copyTool(tool, {
            ...schema,
            type: schema?.type || 'object',
            properties: nextProperties,
            required,
        }),
        injected,
    }
}

function normalizeMetadata(value: unknown, maxLength: number, redact = false): string | undefined {
    if (!isString(value)) {
        return undefined
    }
    const normalized = value.trim()
    if (!normalized) {
        return undefined
    }
    const valueToCapture = redact ? sanitizeFreeText(normalized, INTENT_SANITIZATION_OPTIONS) : normalized
    return valueToCapture.slice(0, maxLength)
}

function getCallMetadata(input: unknown, injected: WebMCPMetadataOptions): WebMCPMetadata {
    if (!isObject(input)) {
        return {}
    }
    try {
        const intent = injected.intent ? normalizeMetadata(input.context, MAX_INTENT_LENGTH, true) : undefined
        const model = injected.model ? normalizeMetadata(input.llm_model, MAX_MODEL_LENGTH) : undefined
        return {
            ...(intent && intent !== '{}' ? { intent } : {}),
            ...(model && model.toLowerCase() !== 'unknown' ? { model } : {}),
        }
    } catch {
        return {}
    }
}

function stripInjectedMetadata(args: unknown[], injected: WebMCPMetadataOptions): unknown[] {
    const input = args[0]
    if (!isObject(input)) {
        return args
    }
    try {
        const removeIntent = injected.intent && hasOwn(input, 'context')
        const removeModel = injected.model && hasOwn(input, 'llm_model')
        if (!removeIntent && !removeModel) {
            return args
        }
        const toolInput = { ...input }
        if (removeIntent) {
            delete toolInput.context
        }
        if (removeModel) {
            delete toolInput.llm_model
        }
        return [toolInput, ...args.slice(1)]
    } catch {
        return args
    }
}

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
        const { tool: wrappedTool, injected } = injectMetadataParameters(tool, getRequestedMetadata(instrumentation))

        Object.defineProperty(wrappedTool, 'execute', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: function (this: unknown, ...args: unknown[]): unknown {
                const startedAt = new Date()
                const metadata = getCallMetadata(args[0], injected)
                const toolArgs = stripInjectedMetadata(args, injected)
                let result: unknown

                try {
                    result = execute.apply(this === wrappedTool ? tool : this, toolArgs)
                } catch (error) {
                    webMCP._captureToolCall(instrumentation, wrappedTool, startedAt, true, metadata)
                    throw error
                }

                if (isPromise(result)) {
                    return Promise.resolve(result).then(
                        (value) => {
                            webMCP._captureToolCall(
                                instrumentation,
                                wrappedTool,
                                startedAt,
                                isErrorResult(value),
                                metadata
                            )
                            return value
                        },
                        (error) => {
                            webMCP._captureToolCall(instrumentation, wrappedTool, startedAt, true, metadata)
                            throw error
                        }
                    )
                }

                webMCP._captureToolCall(instrumentation, wrappedTool, startedAt, isErrorResult(result), metadata)
                return result
            },
        })
        return wrappedTool
    }

    private _captureToolCall(
        instrumentation: WebMCPInstrumentation,
        tool: WebMCPTool,
        timestamp: Date,
        isError: boolean,
        metadata: WebMCPMetadata
    ): void {
        const duration = Date.now() - timestamp.getTime()

        for (const instance of instrumentation.instances) {
            const options = getMetadataOptions(instance.config.capture_webmcp)
            if (!options) {
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
                        ...(options.intent && metadata.intent
                            ? { $mcp_intent: metadata.intent, $mcp_intent_source: 'context_parameter' }
                            : {}),
                        ...(options.model && metadata.model
                            ? { $mcp_llm_model: metadata.model, $mcp_llm_model_source: 'self_reported' }
                            : {}),
                    },
                    { timestamp }
                )
            } catch {
                continue
            }
        }
    }
}
