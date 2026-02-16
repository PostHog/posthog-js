import { AIEvent, truncate } from '../../utils'
import { redactBase64DataUrl } from '../../sanitization'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { PostHogSpanMapper, PostHogSpanMapperResult, UsageData } from '../types'

const OTEL_STATUS_ERROR = 2
const AI_TELEMETRY_METADATA_PREFIX = 'ai.telemetry.metadata.'

function parseJsonValue<T>(value: unknown): T | null {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string') {
    return value as T
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

function toSafeBinaryData(value: unknown): string {
  const asString = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return truncate(redactBase64DataUrl(asString))
}

function toMimeType(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'application/octet-stream'
}

function getSpanLatencySeconds(span: ReadableSpan): number {
  const duration = span.duration
  if (!duration || !Array.isArray(duration) || duration.length !== 2) {
    return 0
  }
  const seconds = Number(duration[0]) || 0
  const nanos = Number(duration[1]) || 0
  return seconds + nanos / 1_000_000_000
}

function getOperationId(span: ReadableSpan): string {
  const attributes = span.attributes || {}
  const operationId = toStringValue(attributes['ai.operationId'])
  if (operationId) {
    return operationId
  }
  return span.name || ''
}

function isDoGenerateSpan(operationId: string): boolean {
  return operationId.endsWith('.doGenerate')
}

function isDoStreamSpan(operationId: string): boolean {
  return operationId.endsWith('.doStream')
}

function isDoEmbedSpan(operationId: string): boolean {
  return operationId.endsWith('.doEmbed')
}

function shouldMapAiSdkSpan(span: ReadableSpan): boolean {
  const operationId = getOperationId(span)
  return isDoGenerateSpan(operationId) || isDoStreamSpan(operationId) || isDoEmbedSpan(operationId)
}

function extractAiSdkTelemetryMetadata(attributes: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith(AI_TELEMETRY_METADATA_PREFIX)) {
      metadata[key.slice(AI_TELEMETRY_METADATA_PREFIX.length)] = value
    }
  }

  if (metadata.traceId && typeof metadata.traceId === 'string') {
    metadata.trace_id = metadata.traceId
  }

  return metadata
}

function mapPromptMessagesInput(attributes: Record<string, unknown>): Array<Record<string, unknown>> {
  const promptMessages = parseJsonValue<Array<Record<string, unknown>>>(attributes['ai.prompt.messages']) || []
  if (!Array.isArray(promptMessages)) {
    return []
  }

  return promptMessages.map((message) => {
    const role = typeof message?.role === 'string' ? message.role : 'user'
    const content = message?.content

    if (typeof content === 'string') {
      return {
        role,
        content: [{ type: 'text', text: truncate(content) }],
      }
    }

    if (Array.isArray(content)) {
      return {
        role,
        content: content.map((part) => {
          if (part && typeof part === 'object' && 'type' in part) {
            const typedPart = part as Record<string, unknown>
            if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
              return {
                type: 'text',
                text: truncate(typedPart.text),
              }
            }
            return typedPart
          }
          return { type: 'text', text: truncate(String(part)) }
        }),
      }
    }

    return {
      role,
      content: [{ type: 'text', text: truncate(content) }],
    }
  })
}

function mapPromptInput(attributes: Record<string, unknown>, operationId: string): any {
  if (isDoEmbedSpan(operationId)) {
    if (attributes['ai.values'] !== undefined) {
      return attributes['ai.values']
    }
    return attributes['ai.value'] ?? null
  }

  const promptMessages = mapPromptMessagesInput(attributes)
  if (promptMessages.length > 0) {
    return promptMessages
  }

  if (attributes['ai.prompt'] !== undefined) {
    return [{ role: 'user', content: [{ type: 'text', text: truncate(attributes['ai.prompt']) }] }]
  }

  return []
}

function mapOutputPart(part: Record<string, unknown>): Record<string, unknown> | null {
  const partType = toStringValue(part.type)

  if (partType === 'text' && typeof part.text === 'string') {
    return { type: 'text', text: truncate(part.text) }
  }

  if (partType === 'tool-call') {
    const toolName = toStringValue(part.toolName) || toStringValue((part as any).function?.name) || ''
    const toolCallId = toStringValue(part.toolCallId) || toStringValue(part.id) || ''
    const input = 'input' in part ? part.input : (part as any).function?.arguments
    if (toolName) {
      return {
        type: 'tool-call',
        id: toolCallId,
        function: {
          name: toolName,
          arguments: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
        },
      }
    }
  }

  if (partType === 'file') {
    const mediaType = toMimeType(part.mediaType ?? part.mimeType ?? part.contentType)
    const data = part.data ?? part.base64 ?? part.bytes ?? part.url ?? part.uri
    if (data !== undefined) {
      return {
        type: 'file',
        name: 'generated_file',
        mediaType,
        data: toSafeBinaryData(data),
      }
    }
  }

  if (partType === 'image') {
    const mediaType = toMimeType(part.mediaType ?? part.mimeType ?? part.contentType ?? 'image/unknown')
    const data =
      part.data ?? part.base64 ?? part.bytes ?? part.url ?? part.uri ?? (part as any).image ?? (part as any).image_url
    if (data !== undefined) {
      return {
        type: 'file',
        name: 'generated_file',
        mediaType,
        data: toSafeBinaryData(data),
      }
    }
  }

  const inlineData = (part as any).inlineData ?? (part as any).inline_data
  if (inlineData && typeof inlineData === 'object' && (inlineData as any).data !== undefined) {
    const mediaType = toMimeType((inlineData as any).mimeType ?? (inlineData as any).mime_type)
    return {
      type: 'file',
      name: 'generated_file',
      mediaType,
      data: toSafeBinaryData((inlineData as any).data),
    }
  }

  if (partType === 'object' && part.object !== undefined) {
    return {
      type: 'object',
      object: part.object,
    }
  }

  return null
}

function mapResponseMessagesOutput(attributes: Record<string, unknown>): Array<Record<string, unknown>> {
  const messagesRaw =
    parseJsonValue<Array<Record<string, unknown>>>(attributes['ai.response.messages']) ??
    parseJsonValue<Record<string, unknown>>(attributes['ai.response.message'])

  if (!messagesRaw) {
    return []
  }

  const messages = Array.isArray(messagesRaw) ? messagesRaw : [messagesRaw]
  const mappedMessages: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue
    }

    const role = toStringValue(message.role) || 'assistant'
    const content = (message as any).content

    if (typeof content === 'string') {
      mappedMessages.push({
        role,
        content: [{ type: 'text', text: truncate(content) }],
      })
      continue
    }

    if (Array.isArray(content)) {
      const parts = content
        .map((part) => (part && typeof part === 'object' ? mapOutputPart(part as Record<string, unknown>) : null))
        .filter((part): part is Record<string, unknown> => part !== null)
      if (parts.length > 0) {
        mappedMessages.push({
          role,
          content: parts,
        })
      }
      continue
    }
  }

  return mappedMessages
}

function mapTextToolObjectOutputParts(attributes: Record<string, unknown>): Array<Record<string, unknown>> {
  const responseText = toStringValue(attributes['ai.response.text']) || ''
  const toolCalls = parseJsonValue<Array<Record<string, unknown>>>(attributes['ai.response.toolCalls']) || []
  const responseObjectRaw = attributes['ai.response.object']
  const responseObject = parseJsonValue(responseObjectRaw)
  const contentParts: Array<Record<string, unknown>> = []

  if (responseText) {
    contentParts.push({ type: 'text', text: truncate(responseText) })
  }

  if (responseObjectRaw !== undefined) {
    contentParts.push({
      type: 'object',
      object: responseObject ?? responseObjectRaw,
    })
  }

  if (Array.isArray(toolCalls)) {
    for (const toolCall of toolCalls) {
      if (!toolCall || typeof toolCall !== 'object') {
        continue
      }

      const toolName = typeof toolCall.toolName === 'string' ? toolCall.toolName : ''
      const toolCallId = typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : ''
      if (!toolName) {
        continue
      }

      const input = 'input' in toolCall ? toolCall.input : {}
      contentParts.push({
        type: 'tool-call',
        id: toolCallId,
        function: {
          name: toolName,
          arguments: typeof input === 'string' ? input : JSON.stringify(input),
        },
      })
    }
  }

  return contentParts
}

function mapResponseFilesOutput(attributes: Record<string, unknown>): Array<Record<string, unknown>> {
  const responseFiles = parseJsonValue<Array<Record<string, unknown>>>(attributes['ai.response.files']) || []
  if (!Array.isArray(responseFiles)) {
    return []
  }

  const mapped: Array<Record<string, unknown>> = []
  for (const file of responseFiles) {
    if (!file || typeof file !== 'object') {
      continue
    }

    const mimeType = toMimeType(file.mimeType ?? file.mediaType ?? file.contentType)
    const data = file.data ?? file.base64 ?? file.bytes
    const url = typeof file.url === 'string' ? file.url : typeof file.uri === 'string' ? file.uri : undefined

    if (data !== undefined) {
      mapped.push({
        type: 'file',
        name: 'generated_file',
        mediaType: mimeType,
        data: toSafeBinaryData(data),
      })
      continue
    }

    if (url) {
      mapped.push({
        type: 'file',
        name: 'generated_file',
        mediaType: mimeType,
        data: truncate(url),
      })
    }
  }

  return mapped
}

function extractGeminiParts(providerMetadata: unknown): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item)
      }
      return
    }

    const objectNode = node as Record<string, unknown>
    const maybeParts = objectNode.parts
    if (Array.isArray(maybeParts)) {
      for (const part of maybeParts) {
        if (part && typeof part === 'object') {
          parts.push(part as Record<string, unknown>)
        }
      }
    }

    for (const value of Object.values(objectNode)) {
      visit(value)
    }
  }

  visit(providerMetadata)
  return parts
}

function mapProviderMetadataInlineDataOutput(providerMetadata: unknown): Array<Record<string, unknown>> {
  const parts = extractGeminiParts(providerMetadata)
  const mapped: Array<Record<string, unknown>> = []

  for (const part of parts) {
    const inlineData = part.inlineData ?? part.inline_data
    if (!inlineData || typeof inlineData !== 'object') {
      continue
    }

    const mimeType = toMimeType((inlineData as any).mimeType ?? (inlineData as any).mime_type)
    if ((inlineData as any).data === undefined) {
      continue
    }

    mapped.push({
      type: 'file',
      name: 'generated_file',
      mediaType: mimeType,
      data: toSafeBinaryData((inlineData as any).data),
    })
  }

  return mapped
}

function mapProviderMetadataTextOutput(providerMetadata: unknown): Array<Record<string, unknown>> {
  const parts = extractGeminiParts(providerMetadata)
  const mapped: Array<Record<string, unknown>> = []
  for (const part of parts) {
    if (typeof part.text === 'string' && part.text.length > 0) {
      mapped.push({
        type: 'text',
        text: truncate(part.text),
      })
    }
  }
  return mapped
}

function extractMediaBlocksFromUnknownNode(node: unknown): Array<Record<string, unknown>> {
  const mapped: Array<Record<string, unknown>> = []

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') {
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
      }
      return
    }

    const objectValue = value as Record<string, unknown>
    const inlineData = (objectValue as any).inlineData ?? (objectValue as any).inline_data
    if (inlineData && typeof inlineData === 'object' && (inlineData as any).data !== undefined) {
      const mediaType = toMimeType((inlineData as any).mimeType ?? (inlineData as any).mime_type)
      mapped.push({
        type: 'file',
        name: 'generated_file',
        mediaType,
        data: toSafeBinaryData((inlineData as any).data),
      })
    }

    if ((objectValue.type === 'file' || 'mediaType' in objectValue || 'mimeType' in objectValue) && objectValue.data) {
      const mediaType = toMimeType((objectValue as any).mediaType ?? (objectValue as any).mimeType)
      mapped.push({
        type: 'file',
        name: 'generated_file',
        mediaType,
        data: toSafeBinaryData(objectValue.data),
      })
    }

    for (const child of Object.values(objectValue)) {
      visit(child)
    }
  }

  visit(node)
  return mapped
}

function mapUnknownResponseAttributeMediaOutput(attributes: Record<string, unknown>): Array<Record<string, unknown>> {
  const mapped: Array<Record<string, unknown>> = []
  for (const [key, value] of Object.entries(attributes)) {
    if (!key.startsWith('ai.response.')) {
      continue
    }
    if (
      key === 'ai.response.text' ||
      key === 'ai.response.toolCalls' ||
      key === 'ai.response.object' ||
      key === 'ai.response.files' ||
      key === 'ai.response.message' ||
      key === 'ai.response.messages' ||
      key === 'ai.response.providerMetadata'
    ) {
      continue
    }

    const parsed = typeof value === 'string' ? (parseJsonValue(value) ?? value) : value
    mapped.push(...extractMediaBlocksFromUnknownNode(parsed))
  }
  return mapped
}

function mapGenericResponseAttributeMediaOutput(attributes: Record<string, unknown>): Array<Record<string, unknown>> {
  const mapped: Array<Record<string, unknown>> = []
  for (const [key, value] of Object.entries(attributes)) {
    if (
      !key.includes('response') ||
      key.startsWith('ai.response.') ||
      key === 'ai.response.providerMetadata' ||
      key.startsWith('ai.prompt.') ||
      key.startsWith('gen_ai.request.')
    ) {
      continue
    }

    const parsed = typeof value === 'string' ? parseJsonValue(value) : value
    if (parsed === null || parsed === undefined) {
      continue
    }
    mapped.push(...extractMediaBlocksFromUnknownNode(parsed))
  }
  return mapped
}

function dedupeContentParts(parts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>()
  const deduped: Array<Record<string, unknown>> = []
  for (const part of parts) {
    const key = JSON.stringify(part)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(part)
  }
  return deduped
}

function mapOutput(attributes: Record<string, unknown>, operationId: string, providerMetadata: unknown): any {
  if (isDoEmbedSpan(operationId)) {
    // Keep embedding behavior aligned with existing provider wrappers.
    return null
  }

  const responseMessages = mapResponseMessagesOutput(attributes)
  if (responseMessages.length > 0) {
    return responseMessages
  }

  const textToolObjectParts = mapTextToolObjectOutputParts(attributes)
  const responseFileParts = mapResponseFilesOutput(attributes)
  const unknownMediaParts = mapUnknownResponseAttributeMediaOutput(attributes)
  const genericResponseMediaParts = mapGenericResponseAttributeMediaOutput(attributes)
  const providerMetadataTextParts = mapProviderMetadataTextOutput(providerMetadata)
  const providerMetadataInlineParts = mapProviderMetadataInlineDataOutput(providerMetadata)

  const mergedContentParts = dedupeContentParts([
    ...textToolObjectParts,
    ...responseFileParts,
    ...unknownMediaParts,
    ...genericResponseMediaParts,
    ...providerMetadataTextParts,
    ...providerMetadataInlineParts,
  ])
  const contentParts = mergedContentParts

  if (contentParts.length === 0) {
    return []
  }

  return [
    {
      role: 'assistant',
      content: contentParts,
    },
  ]
}

function mapModelSettings(attributes: Record<string, unknown>, operationId: string): Record<string, unknown> {
  const temperature =
    toNumber(attributes['ai.settings.temperature']) ?? toNumber(attributes['gen_ai.request.temperature'])
  const maxTokens = toNumber(attributes['ai.settings.maxTokens']) ?? toNumber(attributes['gen_ai.request.max_tokens'])
  const maxOutputTokens = toNumber(attributes['ai.settings.maxOutputTokens'])
  const topP = toNumber(attributes['ai.settings.topP']) ?? toNumber(attributes['gen_ai.request.top_p'])
  const frequencyPenalty =
    toNumber(attributes['ai.settings.frequencyPenalty']) ?? toNumber(attributes['gen_ai.request.frequency_penalty'])
  const presencePenalty =
    toNumber(attributes['ai.settings.presencePenalty']) ?? toNumber(attributes['gen_ai.request.presence_penalty'])
  const stopSequences =
    parseJsonValue<string[] | string>(attributes['ai.settings.stopSequences']) ??
    parseJsonValue<string[] | string>(attributes['gen_ai.request.stop_sequences'])
  const stream = isDoStreamSpan(operationId)

  return {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(maxOutputTokens !== undefined ? { max_completion_tokens: maxOutputTokens } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(frequencyPenalty !== undefined ? { frequency_penalty: frequencyPenalty } : {}),
    ...(presencePenalty !== undefined ? { presence_penalty: presencePenalty } : {}),
    ...(stopSequences !== null ? { stop: stopSequences } : {}),
    ...(stream ? { stream: true } : {}),
  }
}

function mapUsage(attributes: Record<string, unknown>, providerMetadata: unknown, operationId: string): UsageData {
  if (isDoEmbedSpan(operationId)) {
    const tokens = toNumber(attributes['ai.usage.tokens']) ?? toNumber(attributes['gen_ai.usage.input_tokens']) ?? 0
    return {
      inputTokens: tokens,
      rawUsage: {
        usage: {
          tokens,
        },
        providerMetadata,
      },
    }
  }

  const inputTokens =
    toNumber(attributes['ai.usage.promptTokens']) ?? toNumber(attributes['gen_ai.usage.input_tokens']) ?? 0
  const outputTokens =
    toNumber(attributes['ai.usage.completionTokens']) ?? toNumber(attributes['gen_ai.usage.output_tokens']) ?? 0
  const totalTokens = toNumber(attributes['ai.usage.totalTokens'])
  const reasoningTokens = toNumber(attributes['ai.usage.reasoningTokens'])
  const cachedInputTokens = toNumber(attributes['ai.usage.cachedInputTokens'])

  return {
    inputTokens,
    outputTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cacheReadInputTokens: cachedInputTokens } : {}),
    rawUsage: {
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        ...(totalTokens !== undefined ? { totalTokens } : {}),
      },
      providerMetadata,
    },
  }
}

function parsePromptTools(attributes: Record<string, unknown>): any[] | null {
  const rawTools = attributes['ai.prompt.tools']
  if (!Array.isArray(rawTools)) {
    return null
  }

  const parsedTools: any[] = []
  for (const rawTool of rawTools) {
    if (typeof rawTool === 'string') {
      const parsed = parseJsonValue(rawTool)
      if (parsed !== null) {
        parsedTools.push(parsed)
      }
      continue
    }
    if (rawTool && typeof rawTool === 'object') {
      parsedTools.push(rawTool)
    }
  }

  return parsedTools.length > 0 ? parsedTools : null
}

function extractProviderMetadata(attributes: Record<string, unknown>): unknown {
  const rawProviderMetadata = attributes['ai.response.providerMetadata']
  return parseJsonValue(rawProviderMetadata) || {}
}

function buildPosthogProperties(attributes: Record<string, unknown>, operationId: string): Record<string, unknown> {
  const telemetryMetadata = extractAiSdkTelemetryMetadata(attributes)
  const finishReasons = toStringArray(parseJsonValue(attributes['gen_ai.response.finish_reasons']))
  const finishReason = toStringValue(attributes['ai.response.finishReason']) || finishReasons[0]
  const toolChoice = parseJsonValue(attributes['ai.prompt.toolChoice']) ?? attributes['ai.prompt.toolChoice']

  return {
    ...telemetryMetadata,
    $ai_framework: 'vercel',
    $ai_framework_version: '6',
    ai_operation_id: operationId,
    ...(finishReason ? { ai_finish_reason: finishReason } : {}),
    ...(toStringValue(attributes['ai.response.model']) ? { ai_response_model: attributes['ai.response.model'] } : {}),
    ...(toStringValue(attributes['gen_ai.response.model'])
      ? { ai_response_model: attributes['gen_ai.response.model'] }
      : {}),
    ...(toStringValue(attributes['ai.response.id']) ? { ai_response_id: attributes['ai.response.id'] } : {}),
    ...(toStringValue(attributes['gen_ai.response.id']) ? { ai_response_id: attributes['gen_ai.response.id'] } : {}),
    ...(toStringValue(attributes['ai.response.timestamp'])
      ? { ai_response_timestamp: attributes['ai.response.timestamp'] }
      : {}),
    ...(toNumber(attributes['ai.response.msToFinish']) !== undefined
      ? { ai_response_ms_to_finish: toNumber(attributes['ai.response.msToFinish']) }
      : {}),
    ...(toNumber(attributes['ai.response.avgCompletionTokensPerSecond']) !== undefined
      ? {
          ai_response_avg_completion_tokens_per_second: toNumber(
            attributes['ai.response.avgCompletionTokensPerSecond']
          ),
        }
      : {}),
    ...(toStringValue(attributes['ai.telemetry.functionId'])
      ? { ai_telemetry_function_id: attributes['ai.telemetry.functionId'] }
      : {}),
    ...(toNumber(attributes['ai.settings.maxRetries']) !== undefined
      ? { ai_settings_max_retries: toNumber(attributes['ai.settings.maxRetries']) }
      : {}),
    ...(toNumber(attributes['gen_ai.request.top_k']) !== undefined
      ? { ai_request_top_k: toNumber(attributes['gen_ai.request.top_k']) }
      : {}),
    ...(attributes['ai.schema.name'] !== undefined ? { ai_schema_name: attributes['ai.schema.name'] } : {}),
    ...(attributes['ai.schema.description'] !== undefined
      ? { ai_schema_description: attributes['ai.schema.description'] }
      : {}),
    ...(attributes['ai.settings.output'] !== undefined ? { ai_settings_output: attributes['ai.settings.output'] } : {}),
    ...(toolChoice ? { ai_prompt_tool_choice: toolChoice } : {}),
  }
}

function buildAiSdkMapperResult(span: ReadableSpan): PostHogSpanMapperResult | null {
  const attributes = span.attributes || {}
  const operationId = getOperationId(span)
  const providerMetadata = extractProviderMetadata(attributes)
  const model =
    toStringValue(attributes['ai.model.id']) || toStringValue(attributes['gen_ai.request.model']) || 'unknown'
  const provider = (
    toStringValue(attributes['ai.model.provider']) ||
    toStringValue(attributes['gen_ai.system']) ||
    'unknown'
  ).toLowerCase()
  const latency = getSpanLatencySeconds(span)
  const timeToFirstTokenMs = toNumber(attributes['ai.response.msToFirstChunk'])
  const timeToFirstToken = timeToFirstTokenMs !== undefined ? timeToFirstTokenMs / 1000 : undefined
  const input = mapPromptInput(attributes, operationId)
  const output = mapOutput(attributes, operationId, providerMetadata)
  const usage = mapUsage(attributes, providerMetadata, operationId)
  const modelParams = mapModelSettings(attributes, operationId)
  const tools = parsePromptTools(attributes)
  const httpStatus = toNumber(attributes['http.response.status_code']) || 200
  const eventType = isDoEmbedSpan(operationId) ? AIEvent.Embedding : AIEvent.Generation

  const error =
    span.status?.code === OTEL_STATUS_ERROR ? span.status.message || 'AI SDK span recorded error status' : undefined

  return {
    model,
    provider,
    input,
    output,
    latency,
    timeToFirstToken,
    httpStatus,
    eventType,
    usage,
    tools,
    modelParams,
    posthogProperties: buildPosthogProperties(attributes, operationId),
    error,
  }
}

export const aiSdkSpanMapper: PostHogSpanMapper = {
  name: 'ai-sdk',
  canMap: shouldMapAiSdkSpan,
  map: (span: ReadableSpan): PostHogSpanMapperResult | null => {
    return buildAiSdkMapperResult(span)
  },
}
