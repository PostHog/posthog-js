import { context, trace } from '@opentelemetry/api'
import { v4 as uuidv4 } from 'uuid'

import { PostHogSpanProcessor } from './processor'

const DEFAULT_AI_GATEWAY_HOST = 'https://ai-gateway.us.posthog.com'

export interface PostHogAIOptions {
  projectSecret: string
  host?: string
}

export interface PostHogAIScoreOptions {
  id?: string
  requestId?: string
  traceId?: string
  spanId?: string
  name: string
  value?: number
  label?: string
  explanation?: string
  distinctId?: string
  signal?: AbortSignal
}

export interface PostHogAIScoreResult {
  id: string
}

export class PostHogAI {
  readonly spanProcessor: PostHogSpanProcessor

  private readonly projectSecret: string
  private readonly scoreURL: string

  constructor(options: PostHogAIOptions) {
    this.projectSecret = options.projectSecret.trim()
    if (!this.projectSecret) {
      throw new TypeError('PostHogAI requires a projectSecret')
    }

    const host = new URL(options.host?.trim() || DEFAULT_AI_GATEWAY_HOST).origin
    this.scoreURL = `${host}/i/v0/ai/scores`
    this.spanProcessor = new PostHogSpanProcessor({ projectSecret: this.projectSecret, host })
  }

  async score(options: PostHogAIScoreOptions): Promise<PostHogAIScoreResult> {
    const activeSpanContext = trace.getSpanContext(context.active())
    const traceId = options.traceId?.trim().toLowerCase() || activeSpanContext?.traceId
    const spanId =
      options.spanId?.trim().toLowerCase() ||
      (activeSpanContext && activeSpanContext.traceId === traceId ? activeSpanContext.spanId : undefined)
    const name = options.name.trim()
    const label = options.label?.trim()
    const explanation = options.explanation?.trim()
    const distinctId = options.distinctId?.trim()
    const requestId = options.requestId?.trim()

    if (!traceId) {
      throw new TypeError('PostHogAI.score requires an active span or traceId')
    }
    if (!name) {
      throw new TypeError('PostHogAI.score requires a name')
    }
    if (options.value !== undefined && !Number.isFinite(options.value)) {
      throw new TypeError('PostHogAI.score requires a finite value')
    }
    if (options.value === undefined && !label) {
      throw new TypeError('PostHogAI.score requires a value or label')
    }

    const id = options.id?.trim() || uuidv4()
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.projectSecret}`,
      'Content-Type': 'application/json',
    }
    if (distinctId) {
      headers['X-PostHog-Distinct-Id'] = distinctId
    }

    const response = await fetch(this.scoreURL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id,
        request_id: requestId,
        trace_id: traceId,
        span_id: spanId,
        name,
        value: options.value,
        label,
        explanation,
      }),
      signal: options.signal,
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1024)
      throw new Error(`PostHogAI.score failed with status ${response.status}${detail ? `: ${detail}` : ''}`)
    }

    return (await response.json()) as PostHogAIScoreResult
  }
}
