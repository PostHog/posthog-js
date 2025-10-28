import {
  GoogleGenAI,
  GenerateContentResponse as GeminiResponse,
  GenerateContentParameters,
  Part,
  GenerateContentResponseUsageMetadata,
} from '@google/genai'
import { PostHog } from 'posthog-node'
import {
  MonitoringParams,
  sendEventToPosthog,
  extractAvailableToolCalls,
  formatResponseGemini,
  extractPosthogParams,
  toContentString,
} from '../utils'
import { sanitizeGemini } from '../sanitization'
import type { TokenUsage, FormattedContent, FormattedContentItem, FormattedMessage } from '../types'
import { isString } from '../typeGuards'

interface MonitoringGeminiConfig {
  apiKey?: string
  vertexai?: boolean
  project?: string
  location?: string
  apiVersion?: string
  posthog: PostHog
}

export class PostHogGoogleGenAI {
  private readonly phClient: PostHog
  private readonly client: GoogleGenAI
  public models: WrappedModels

  constructor(config: MonitoringGeminiConfig) {
    const { posthog, ...geminiConfig } = config
    this.phClient = posthog
    this.client = new GoogleGenAI(geminiConfig)
    this.models = new WrappedModels(this.client, this.phClient)
  }
}

export class WrappedModels {
  private readonly phClient: PostHog
  private readonly client: GoogleGenAI

  constructor(client: GoogleGenAI, phClient: PostHog) {
    this.client = client
    this.phClient = phClient
  }

  public async generateContent(params: GenerateContentParameters & MonitoringParams): Promise<GeminiResponse> {
    const { providerParams: geminiParams, posthogParams } = extractPosthogParams(params)
    const startTime = Date.now()

    try {
      const response = await this.client.models.generateContent(geminiParams as GenerateContentParameters)
      const latency = (Date.now() - startTime) / 1000

      const availableTools = extractAvailableToolCalls('gemini', geminiParams)

      const metadata = response.usageMetadata
      await sendEventToPosthog({
        client: this.phClient,
        ...posthogParams,
        model: geminiParams.model,
        provider: 'gemini',
        input: this.formatInputForPostHog(geminiParams),
        output: formatResponseGemini(response),
        latency,
        baseURL: 'https://generativelanguage.googleapis.com',
        params: params as GenerateContentParameters & MonitoringParams,
        httpStatus: 200,
        usage: {
          inputTokens: metadata?.promptTokenCount ?? 0,
          outputTokens: metadata?.candidatesTokenCount ?? 0,
          reasoningTokens:
            (metadata as GenerateContentResponseUsageMetadata & { thoughtsTokenCount?: number })?.thoughtsTokenCount ??
            0,
          cacheReadInputTokens: metadata?.cachedContentTokenCount ?? 0,
          webSearchCount: hasGoogleSearchUsage(response),
        },
        tools: availableTools,
      })

      return response
    } catch (error: unknown) {
      const latency = (Date.now() - startTime) / 1000
      await sendEventToPosthog({
        client: this.phClient,
        ...posthogParams,
        model: geminiParams.model,
        provider: 'gemini',
        input: this.formatInputForPostHog(geminiParams),
        output: [],
        latency,
        baseURL: 'https://generativelanguage.googleapis.com',
        params: params as GenerateContentParameters & MonitoringParams,
        httpStatus: (error as { status?: number })?.status ?? 500,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
        },
        isError: true,
        error: JSON.stringify(error),
      })
      throw error
    }
  }

  public async *generateContentStream(
    params: GenerateContentParameters & MonitoringParams
  ): AsyncGenerator<GeminiResponse, void, unknown> {
    const { providerParams: geminiParams, posthogParams } = extractPosthogParams(params)
    const startTime = Date.now()
    const accumulatedContent: FormattedContent = []
    let usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
    }
    let accumulatedGroundingMetadata: unknown = undefined

    try {
      const stream = await this.client.models.generateContentStream(geminiParams as GenerateContentParameters)

      for await (const chunk of stream) {
        // Handle text content
        if (chunk.text) {
          // Find if we already have a text item to append to
          let lastTextItem: FormattedContentItem | undefined
          for (let i = accumulatedContent.length - 1; i >= 0; i--) {
            if (accumulatedContent[i].type === 'text') {
              lastTextItem = accumulatedContent[i]
              break
            }
          }

          if (lastTextItem && lastTextItem.type === 'text') {
            lastTextItem.text += chunk.text
          } else {
            accumulatedContent.push({ type: 'text', text: chunk.text })
          }
        }

        // Handle function calls and grounding metadata from candidates
        if (chunk.candidates && Array.isArray(chunk.candidates)) {
          for (const candidate of chunk.candidates) {
            // Accumulate grounding metadata if present
            if (candidate.groundingMetadata !== undefined && !accumulatedGroundingMetadata) {
              accumulatedGroundingMetadata = candidate.groundingMetadata
            }

            if (candidate.content && candidate.content.parts) {
              for (const part of candidate.content.parts) {
                // Type-safe check for functionCall
                if ('functionCall' in part) {
                  const funcCall = (part as Part & { functionCall?: { name?: string; args?: unknown } }).functionCall
                  if (funcCall?.name) {
                    accumulatedContent.push({
                      type: 'function',
                      function: {
                        name: funcCall.name,
                        arguments: funcCall.args || {},
                      },
                    })
                  }
                }
              }
            }
          }
        }

        // Update usage metadata - handle both old and new field names
        if (chunk.usageMetadata) {
          const metadata = chunk.usageMetadata as GenerateContentResponseUsageMetadata
          usage = {
            inputTokens: metadata.promptTokenCount ?? 0,
            outputTokens: metadata.candidatesTokenCount ?? 0,
            reasoningTokens:
              (metadata as GenerateContentResponseUsageMetadata & { thoughtsTokenCount?: number }).thoughtsTokenCount ??
              0,
            cacheReadInputTokens: metadata.cachedContentTokenCount ?? 0,
          }
        }
        yield chunk
      }

      const latency = (Date.now() - startTime) / 1000

      const availableTools = extractAvailableToolCalls('gemini', geminiParams)

      // Format output similar to formatResponseGemini
      const output = accumulatedContent.length > 0 ? [{ role: 'assistant', content: accumulatedContent }] : []

      // Build a mock response structure to check for grounding
      const mockResponse = {
        candidates: accumulatedContent.length > 0
          ? [{
              content: { parts: accumulatedContent },
              ...(accumulatedGroundingMetadata ? { groundingMetadata: accumulatedGroundingMetadata } : {})
            }]
          : []
      }

      await sendEventToPosthog({
        client: this.phClient,
        ...posthogParams,
        model: geminiParams.model,
        provider: 'gemini',
        input: this.formatInputForPostHog(geminiParams),
        output,
        latency,
        baseURL: 'https://generativelanguage.googleapis.com',
        params: params as GenerateContentParameters & MonitoringParams,
        httpStatus: 200,
        usage: {
          ...usage,
          webSearchCount: hasGoogleSearchUsage(mockResponse),
        },
        tools: availableTools,
      })
    } catch (error: unknown) {
      const latency = (Date.now() - startTime) / 1000
      await sendEventToPosthog({
        client: this.phClient,
        ...posthogParams,
        model: geminiParams.model,
        provider: 'gemini',
        input: this.formatInputForPostHog(geminiParams),
        output: [],
        latency,
        baseURL: 'https://generativelanguage.googleapis.com',
        params: params as GenerateContentParameters & MonitoringParams,
        httpStatus: (error as { status?: number })?.status ?? 500,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
        },
        isError: true,
        error: JSON.stringify(error),
      })
      throw error
    }
  }

  private formatInput(contents: unknown): FormattedMessage[] {
    if (typeof contents === 'string') {
      return [{ role: 'user', content: contents }]
    }

    if (Array.isArray(contents)) {
      return contents.map((item) => {
        if (typeof item === 'string') {
          return { role: 'user', content: item }
        }

        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          if ('text' in obj && obj.text) {
            return { role: isString(obj.role) ? obj.role : 'user', content: obj.text }
          }

          if ('content' in obj && obj.content) {
            return { role: isString(obj.role) ? obj.role : 'user', content: obj.content }
          }

          if ('parts' in obj && Array.isArray(obj.parts)) {
            return {
              role: isString(obj.role) ? obj.role : 'user',
              content: obj.parts.map((part: unknown) => {
                if (part && typeof part === 'object' && 'text' in part) {
                  return (part as { text: unknown }).text
                }
                return part
              }),
            }
          }
        }

        return { role: 'user', content: toContentString(item) }
      })
    }

    if (contents && typeof contents === 'object') {
      const obj = contents as Record<string, unknown>
      if ('text' in obj && obj.text) {
        return [{ role: 'user', content: obj.text }]
      }

      if ('content' in obj && obj.content) {
        return [{ role: 'user', content: obj.content }]
      }
    }

    return [{ role: 'user', content: toContentString(contents) }]
  }

  private extractSystemInstruction(params: GenerateContentParameters): string | null {
    if (!params || typeof params !== 'object' || !params.config) {
      return null
    }
    const config = params.config as any
    if (!('systemInstruction' in config)) {
      return null
    }
    const systemInstruction = config.systemInstruction
    if (typeof systemInstruction === 'string') {
      return systemInstruction
    }
    if (systemInstruction && typeof systemInstruction === 'object' && 'text' in systemInstruction) {
      return systemInstruction.text
    }
    if (
      systemInstruction &&
      typeof systemInstruction === 'object' &&
      'parts' in systemInstruction &&
      Array.isArray(systemInstruction.parts)
    ) {
      for (const part of systemInstruction.parts) {
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text
        }
      }
    }
    if (Array.isArray(systemInstruction)) {
      for (const part of systemInstruction) {
        if (typeof part === 'string') {
          return part
        }
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text
        }
      }
    }
    return null
  }

  private formatInputForPostHog(params: GenerateContentParameters): FormattedMessage[] {
    const sanitized = sanitizeGemini(params.contents)
    const messages = this.formatInput(sanitized)

    const systemInstruction = this.extractSystemInstruction(params)

    if (systemInstruction) {
      const hasSystemMessage = messages.some((msg: FormattedMessage) => msg.role === 'system')

      if (!hasSystemMessage) {
        return [{ role: 'system', content: systemInstruction }, ...messages]
      }
    }

    return messages
  }
}

/**
 * Detect if Google Search grounding was used in the response.
 * Gemini bills per request that uses grounding, not per individual query.
 * Returns 1 if grounding was used, 0 otherwise.
 */
function hasGoogleSearchUsage(response: unknown): number {
  if (!response || typeof response !== 'object' || !('candidates' in response)) {
    return 0
  }

  const candidates = response.candidates

  if (!Array.isArray(candidates)) {
    return 0
  }

  const hasGrounding = candidates.some((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') {
      return false
    }

    // Check for grounding metadata
    if ('groundingMetadata' in candidate && candidate.groundingMetadata !== undefined) {
      return true
    }

    // Check for google search in function calls
    if ('content' in candidate && candidate.content && typeof candidate.content === 'object') {
      const content = candidate.content

      if ('parts' in content && Array.isArray(content.parts)) {
        return content.parts.some((part: unknown) => {
          if (!part || typeof part !== 'object' || !('functionCall' in part)) {
            return false
          }

          const functionCall = part.functionCall

          if (
            functionCall &&
            typeof functionCall === 'object' &&
            'name' in functionCall &&
            typeof functionCall.name === 'string'
          ) {
            return functionCall.name.includes('google_search') || functionCall.name.includes('grounding')
          }

          return false
        })
      }
    }

    return false
  })

  return hasGrounding ? 1 : 0
}

export default PostHogGoogleGenAI
export { PostHogGoogleGenAI as Gemini }
