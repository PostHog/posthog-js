import { GoogleGenAI } from '@google/genai'
import { PostHog } from 'posthog-node'
import { v4 as uuidv4 } from 'uuid'
import { MonitoringParams, sendEventToPosthog } from '../utils'

// Types from @google/genai
type GenerateContentRequest = {
  model: string
  contents: any
  config?: any
  [key: string]: any
}

type GenerateContentResponse = {
  text?: string
  candidates?: any[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  [key: string]: any
}

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

  public async generateContent(params: GenerateContentRequest & MonitoringParams): Promise<GenerateContentResponse> {
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogProperties,
      posthogGroups,
      posthogCaptureImmediate,
      ...geminiParams
    } = params

    const traceId = posthogTraceId ?? uuidv4()
    const startTime = Date.now()

    try {
      const response = await this.client.models.generateContent(geminiParams)
      const latency = (Date.now() - startTime) / 1000

      await sendEventToPosthog({
        client: this.phClient,
        distinctId: posthogDistinctId ?? traceId,
        traceId,
        model: geminiParams.model,
        provider: 'gemini',
        input: this.formatInput(geminiParams.contents),
        output: this.formatOutput(response),
        latency,
        baseURL: 'https://generativelanguage.googleapis.com',
        params: params as any,
        httpStatus: 200,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
        captureImmediate: posthogCaptureImmediate,
      })

      return response
    } catch (error: any) {
      const latency = (Date.now() - startTime) / 1000
      await sendEventToPosthog({
        client: this.phClient,
        distinctId: posthogDistinctId ?? traceId,
        traceId,
        model: geminiParams.model,
        provider: 'gemini',
        input: this.formatInput(geminiParams.contents),
        output: [],
        latency,
        baseURL: 'https://generativelanguage.googleapis.com',
        params: params as any,
        httpStatus: error?.status ?? 500,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
        },
        isError: true,
        error: JSON.stringify(error),
        captureImmediate: posthogCaptureImmediate,
      })
      throw error
    }
  }

  public async *generateContentStream(
    params: GenerateContentRequest & MonitoringParams
  ): AsyncGenerator<any, void, unknown> {
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogProperties,
      posthogGroups,
      posthogCaptureImmediate,
      ...geminiParams
    } = params

    const traceId = posthogTraceId ?? uuidv4()
    const startTime = Date.now()
    let accumulatedContent = ''
    let usage = {
      inputTokens: 0,
      outputTokens: 0,
    }

    try {
      const stream = await this.client.models.generateContentStream(geminiParams)

      for await (const chunk of stream) {
        if (chunk.text) {
          accumulatedContent += chunk.text
        }
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
          }
        }
        yield chunk
      }

      const latency = (Date.now() - startTime) / 1000
      await sendEventToPosthog({
        client: this.phClient,
        distinctId: posthogDistinctId ?? traceId,
        traceId,
        model: geminiParams.model,
        provider: 'gemini',
        input: this.formatInput(geminiParams.contents),
        output: [{ content: accumulatedContent, role: 'assistant' }],
        latency,
        baseURL: 'https://generativelanguage.googleapis.com',
        params: params as any,
        httpStatus: 200,
        usage,
        captureImmediate: posthogCaptureImmediate,
      })
    } catch (error: any) {
      const latency = (Date.now() - startTime) / 1000
      await sendEventToPosthog({
        client: this.phClient,
        distinctId: posthogDistinctId ?? traceId,
        traceId,
        model: geminiParams.model,
        provider: 'gemini',
        input: this.formatInput(geminiParams.contents),
        output: [],
        latency,
        baseURL: 'https://generativelanguage.googleapis.com',
        params: params as any,
        httpStatus: error?.status ?? 500,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
        },
        isError: true,
        error: JSON.stringify(error),
        captureImmediate: posthogCaptureImmediate,
      })
      throw error
    }
  }

  private formatInput(contents: any): Array<{ role: string; content: string }> {
    if (typeof contents === 'string') {
      return [{ role: 'user', content: contents }]
    }

    if (Array.isArray(contents)) {
      return contents.map((item) => {
        if (typeof item === 'string') {
          return { role: 'user', content: item }
        }
        if (item && typeof item === 'object') {
          if (item.text) {
            return { role: item.role || 'user', content: item.text }
          }
          if (item.content) {
            return { role: item.role || 'user', content: item.content }
          }
        }
        return { role: 'user', content: String(item) }
      })
    }

    if (contents && typeof contents === 'object') {
      if (contents.text) {
        return [{ role: 'user', content: contents.text }]
      }
      if (contents.content) {
        return [{ role: 'user', content: contents.content }]
      }
    }

    return [{ role: 'user', content: String(contents) }]
  }

  private formatOutput(response: GenerateContentResponse): Array<{ role: string; content: string }> {
    if (response.text) {
      return [{ role: 'assistant', content: response.text }]
    }

    if (response.candidates && Array.isArray(response.candidates)) {
      return response.candidates.map((candidate) => {
        if (candidate.content && candidate.content.parts) {
          const text = candidate.content.parts
            .filter((part: any) => part.text)
            .map((part: any) => part.text)
            .join('')
          return { role: 'assistant', content: text }
        }
        return { role: 'assistant', content: String(candidate) }
      })
    }

    return []
  }
}

export default PostHogGoogleGenAI
export { PostHogGoogleGenAI as Gemini }
