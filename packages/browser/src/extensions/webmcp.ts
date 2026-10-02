import { isArray, isFunction, isObject, isPromise, isString, isUndefined } from '@posthog/core'
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
const MAX_INTENT_LENGTH = 2048
const MAX_MODEL_LENGTH = 256
const REDACTED_VALUE = '[redacted]'
const UNICODE_SPACE_PATTERN = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g
const IPV6_PATTERN =
    /(^|[^0-9A-Fa-f:])((?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,5}|::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})))(?=$|[^0-9A-Fa-f:])/g
const CREDIT_CARD_CANDIDATE_PATTERN = /\b\d(?:[ ./-]?\d){12,}\b/g
const DIGIT_GROUP_PATTERN = /\d+/g
const US_SSN_PATTERN = /\b\d{3}[ .-]\d{2}[ .-]\d{4}\b/g
const PHONE_NANP_PATTERN = /(^|[^\w+])((?:\+?1[ ./-]?)?(?:\(\d{3}\)[ ./-]?|\d{3}[ ./-])\d{3}[ ./-]\d{4})(?=$|[^\w])/g
const PHONE_INTL_PATTERN = /(^|[^\w])(\+\d{1,3}(?:[ ./()-]{0,2}\d){7,13})(?=$|[^\w])/g

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

function passesLuhn(digits: string): boolean {
    let sum = 0
    let double = false
    for (let index = digits.length - 1; index >= 0; index--) {
        let digit = digits.charCodeAt(index) - 48
        if (double) {
            digit *= 2
            if (digit > 9) {
                digit -= 9
            }
        }
        sum += digit
        double = !double
    }
    return sum % 10 === 0
}

function redactCardNumbers(match: string): string {
    const groups: { digits: string; start: number; end: number }[] = []
    for (let result = DIGIT_GROUP_PATTERN.exec(match); result; result = DIGIT_GROUP_PATTERN.exec(match)) {
        groups.push({ digits: result[0], start: result.index, end: result.index + result[0].length })
    }

    let output = ''
    let cursor = 0
    for (let first = 0; first < groups.length; first++) {
        let digits = ''
        let matchedLast = -1
        for (let last = first; last < groups.length; last++) {
            digits += groups[last].digits
            if (digits.length > 19) {
                break
            }
            if (digits.length >= 13 && passesLuhn(digits)) {
                matchedLast = last
            }
        }
        if (matchedLast >= 0) {
            output += match.slice(cursor, groups[first].start) + REDACTED_VALUE
            cursor = groups[matchedLast].end
            first = matchedLast
        }
    }
    return output + match.slice(cursor)
}

function redactIntent(value: string): string {
    return value
        .replace(UNICODE_SPACE_PATTERN, ' ')
        .replace(EMAIL_PATTERN, REDACTED_VALUE)
        .replace(IPV4_PATTERN, REDACTED_VALUE)
        .replace(IPV6_PATTERN, `$1${REDACTED_VALUE}`)
        .replace(CREDIT_CARD_CANDIDATE_PATTERN, redactCardNumbers)
        .replace(US_SSN_PATTERN, REDACTED_VALUE)
        .replace(PHONE_NANP_PATTERN, `$1${REDACTED_VALUE}`)
        .replace(PHONE_INTL_PATTERN, `$1${REDACTED_VALUE}`)
}

function injectMetadataParameters(
    tool: WebMCPTool,
    requested: WebMCPMetadataOptions
): { tool: WebMCPTool; injected: WebMCPMetadataOptions } {
    const injected = { intent: false, model: false }
    const schema = tool.inputSchema

    if (
        (schema &&
            (hasOwn(schema, '$ref') ||
                hasOwn(schema, 'oneOf') ||
                hasOwn(schema, 'anyOf') ||
                hasOwn(schema, 'allOf') ||
                schema.additionalProperties === true ||
                isObject(schema.additionalProperties) ||
                (schema.type && schema.type !== 'object') ||
                (schema.properties && !isObject(schema.properties)) ||
                (schema.required && !isArray(schema.required)))) ||
        (!isUndefined(schema) && !isObject(schema))
    ) {
        return { tool: { ...tool }, injected }
    }

    const properties = schema?.properties || {}
    injected.intent = requested.intent && !hasOwn(properties, 'context')
    injected.model = requested.model && !hasOwn(properties, 'llm_model')

    if (!injected.intent && !injected.model) {
        return { tool: { ...tool }, injected }
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
        tool: {
            ...tool,
            inputSchema: {
                ...schema,
                type: schema?.type || 'object',
                properties: nextProperties,
                required,
            },
        },
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
    const valueToCapture = redact ? redactIntent(normalized.slice(0, maxLength * 2)) : normalized
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

        wrappedTool.execute = function (...args): unknown {
            const startedAt = new Date()
            const metadata = getCallMetadata(args[0], injected)
            const toolArgs = stripInjectedMetadata(args, injected)
            let result: unknown

            try {
                result = execute.apply(this, toolArgs)
            } catch (error) {
                webMCP._captureToolCall(instrumentation, wrappedTool, startedAt, true, metadata)
                throw error
            }

            if (isPromise(result)) {
                return Promise.resolve(result).then(
                    (value) => {
                        webMCP._captureToolCall(instrumentation, wrappedTool, startedAt, isErrorResult(value), metadata)
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
        }
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
