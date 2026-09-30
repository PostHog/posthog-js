import type { GoogleGenAI } from '@google/genai'
import type { PostHog } from 'posthog-node'
import { captureAiGeneration } from '../captureAiGeneration'
import { sanitizeGemini } from '../sanitization'
import type { FormattedMessage, TokenUsage } from '../types'
import { extractPosthogParams, withPrivacyMode, type MonitoringParams } from '../utils'

type Create = GoogleGenAI['interactions']['create']
type CreateParams = Parameters<Create>[0]
type ForegroundParams = CreateParams & { model: string; agent?: never; background?: false }
type CreateOptions = Parameters<Create>[1]
type CreateResult = Awaited<ReturnType<Create>>
type Interaction = Exclude<CreateResult, AsyncIterable<unknown>>
type InteractionStream = Extract<CreateResult, AsyncIterable<unknown>>
type InteractionEvent = InteractionStream extends AsyncIterable<infer Event> ? Event : never

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isStream(value: unknown): value is AsyncIterable<InteractionEvent> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in value
}

function usageFromInteraction(value: unknown, model?: string): TokenUsage {
  const usage = record(value)
  if (!usage) return {}

  const cached = number(usage.total_cached_tokens)
  const searches = Array.isArray(usage.grounding_tool_count)
    ? usage.grounding_tool_count.reduce((total, entry) => {
        const grounding = record(entry)
        return total + (grounding?.type === 'google_search' ? (number(grounding.count) ?? 0) : 0)
      }, 0)
    : undefined
  const modelMajor = /^(?:models\/)?gemini-(\d+)/.exec(model ?? '')?.[1]
  const webSearchCount = modelMajor === undefined ? undefined : Number(modelMajor) >= 3 ? searches : searches ? 1 : 0
  return {
    inputTokens: number(usage.total_input_tokens),
    outputTokens: number(usage.total_output_tokens),
    reasoningTokens: number(usage.total_thought_tokens),
    cacheReadInputTokens: cached,
    ...(cached !== undefined ? { cacheReportingExclusive: false } : {}),
    webSearchCount,
    rawUsage: usage,
  }
}

function functionArguments(value: unknown): string | RecordValue {
  if (typeof value !== 'string') return record(value) ?? {}
  try {
    return record(JSON.parse(value)) ?? value
  } catch {
    return value
  }
}

function outputFromSteps(steps: unknown, fallbackText?: string): FormattedMessage[] {
  const content: unknown[] = []
  if (Array.isArray(steps)) {
    for (const rawStep of steps) {
      const step = record(rawStep)
      if (step?.type === 'model_output' && Array.isArray(step.content)) {
        content.push(...step.content)
      } else if (step?.type === 'function_call' && string(step.name)) {
        content.push({
          type: 'function',
          id: string(step.id),
          function: { name: step.name, arguments: functionArguments(step.arguments) },
        })
      }
    }
  }
  if (content.length === 0 && fallbackText) content.push({ type: 'text', text: fallbackText })
  return content.length ? [{ role: 'assistant', content }] : []
}

function inputFromRequest(input: unknown, systemInstruction?: unknown): FormattedMessage[] {
  const messages: FormattedMessage[] = []
  if (typeof systemInstruction === 'string') messages.push({ role: 'system', content: systemInstruction })

  for (const part of Array.isArray(input) ? input : [input]) {
    const step = record(part)
    if (step?.type === 'function_result') {
      messages.push({ role: 'tool', content: [part] })
    } else if (step?.type === 'user_input') {
      messages.push({ role: 'user', content: step.content ?? [part] })
    } else if (step?.type === 'model_output') {
      messages.push({ role: 'assistant', content: step.content ?? [part] })
    } else if (step?.type === 'function_call') {
      const output = outputFromSteps([part])
      messages.push(...(output.length ? output : [{ role: 'assistant', content: [part] }]))
    } else {
      messages.push({ role: 'user', content: part })
    }
  }
  return messages
}

function safeTools(tools: unknown): unknown[] | undefined {
  if (!Array.isArray(tools)) return undefined
  return tools.map((tool) => ({ type: string(record(tool)?.type), name: string(record(tool)?.name) }))
}

function isFailure(status: unknown): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'incomplete' || status === 'budget_exceeded'
}

interface StreamStep {
  type?: unknown
  id?: unknown
  name?: unknown
  content?: unknown[]
  arguments?: unknown
  argumentChunks?: string
}

export class WrappedInteractions {
  constructor(
    private readonly client: GoogleGenAI,
    private readonly phClient: PostHog
  ) {}

  public create(
    params: ForegroundParams & MonitoringParams & { stream: true },
    options?: CreateOptions
  ): Promise<ReadableStream<InteractionEvent> & AsyncIterable<InteractionEvent>>
  public create(
    params: ForegroundParams & MonitoringParams & { stream?: false },
    options?: CreateOptions
  ): Promise<Interaction>
  public create(
    params: ForegroundParams & MonitoringParams,
    options?: CreateOptions
  ): Promise<Interaction | (ReadableStream<InteractionEvent> & AsyncIterable<InteractionEvent>)>
  public async create(
    params: ForegroundParams & MonitoringParams,
    options?: CreateOptions
  ): Promise<Interaction | (ReadableStream<InteractionEvent> & AsyncIterable<InteractionEvent>)> {
    const { providerParams, posthogParams } = extractPosthogParams(params)
    const request = providerParams as CreateParams
    const requestData = record(request) ?? {}
    if (requestData.background === true || typeof requestData.model !== 'string' || requestData.agent !== undefined) {
      throw new Error('Gemini Interactions tracing supports foreground model calls only')
    }
    const startTime = Date.now()

    const capture = async (
      interaction?: RecordValue,
      error?: unknown,
      output?: FormattedMessage[],
      firstTokenTime?: number
    ) => {
      try {
        const privateCapture = withPrivacyMode(this.phClient, posthogParams.privacyMode, false) === null
        const model = string(interaction?.model) ?? string(requestData.model)
        const generationConfig = record(requestData.generation_config)
        const modelParameters = privateCapture
          ? {}
          : {
              ...(number(generationConfig?.max_output_tokens) !== undefined
                ? { max_tokens: generationConfig?.max_output_tokens }
                : {}),
              ...(string(generationConfig?.thinking_level) !== undefined
                ? { thinking_level: generationConfig?.thinking_level }
                : {}),
            }
        await captureAiGeneration(this.phClient, {
          ...posthogParams,
          model,
          provider: 'gemini',
          input: privateCapture
            ? null
            : inputFromRequest(
                sanitizeGemini(requestData.input, this.phClient),
                sanitizeGemini(requestData.system_instruction, this.phClient)
              ),
          output: privateCapture
            ? null
            : sanitizeGemini(
                output ?? outputFromSteps(interaction?.steps, string(interaction?.output_text)),
                this.phClient
              ),
          latency: (Date.now() - startTime) / 1000,
          timeToFirstToken: firstTokenTime === undefined ? undefined : (firstTokenTime - startTime) / 1000,
          baseURL: 'https://generativelanguage.googleapis.com',
          modelParameters,
          completionId: string(interaction?.id),
          stopReason: string(interaction?.status),
          servedServiceTier: string(interaction?.service_tier),
          usage: usageFromInteraction(interaction?.usage, model),
          tools: privateCapture ? undefined : safeTools(requestData.tools),
          error: privateCapture && error ? new Error('Gemini interaction failed') : error,
        })
      } catch {
        // Telemetry preparation is best effort, including getters, redaction, and capture.
        // Never replace a provider result/error or expose content in diagnostics.
      }
    }

    try {
      if (!this.client.interactions?.create) {
        throw new Error('Gemini Interactions requires @google/genai 2.18.0 or newer')
      }

      const result = await (options === undefined
        ? this.client.interactions.create(request)
        : this.client.interactions.create(request, options))
      if (requestData.stream === true) {
        if (!isStream(result)) throw new Error('Gemini Interactions did not return a stream')
        return this.wrapStream(result, capture)
      }
      if (isStream(result)) throw new Error('Gemini Interactions returned an unexpected stream')

      const interaction = record(result)
      let unsupportedSchema = false
      try {
        unsupportedSchema = Array.isArray(interaction?.outputs) && !Array.isArray(interaction?.steps)
      } catch {
        // Incidental observation failures must not reject a successful provider result.
        return result as Interaction
      }
      if (unsupportedSchema) {
        throw new Error('Gemini Interactions GA schema requires @google/genai 2.18.0 or newer')
      }
      try {
        const status = interaction?.status
        if (status !== 'queued' && status !== 'in_progress') {
          await capture(interaction, isFailure(status) ? new Error(`Gemini interaction ${status}`) : undefined)
        }
      } catch {
        // Reading a provider's status is telemetry preparation too.
      }
      return result as Interaction
    } catch (error) {
      await capture(undefined, error)
      throw error
    }
  }

  private wrapStream(
    stream: AsyncIterable<InteractionEvent>,
    capture: (
      interaction?: RecordValue,
      error?: unknown,
      output?: FormattedMessage[],
      firstTokenTime?: number
    ) => Promise<void>
  ): ReadableStream<InteractionEvent> & AsyncIterable<InteractionEvent> {
    // SDK 2.x streams expose a reader whose cancellation interrupts a pending read.
    // Returning an async generator instead queues cancellation behind its next().
    const reader =
      'getReader' in stream && typeof stream.getReader === 'function'
        ? (stream as ReadableStream<InteractionEvent> & AsyncIterable<InteractionEvent>).getReader()
        : undefined
    const iterator = reader ? undefined : stream[Symbol.asyncIterator]()
    let readerReleased = false
    let errorIterator: AsyncIterator<InteractionEvent> | undefined
    let readError: unknown
    const next = async () => {
      if (!reader) return iterator!.next()
      try {
        return await reader.read()
      } catch (providerError) {
        if (closed) throw providerError
        readError = providerError
        release()
        try {
          errorIterator = stream[Symbol.asyncIterator]()
        } catch {
          throw providerError
        }
        try {
          // The SDK normalizes errors in its iterator, but not in getReader().
          // An errored stream retains its error: this read performs no provider I/O.
          await errorIterator.next()
        } finally {
          try {
            await errorIterator.return?.()
          } catch {
            // Cleanup cannot replace the error from the read.
          }
        }
        throw providerError
      }
    }
    const cancelSource = async (reason?: unknown) => {
      if (reader && !readerReleased) await reader.cancel(reason)
      else if (reader) {
        // A failed read already released the reader for SDK error normalization.
        // Its iterator owns the lock now; never cancel through the stale reader.
        try {
          await errorIterator?.return?.()
        } catch {
          // The provider stream has already failed; its read error remains authoritative.
        }
        throw readError
      } else await iterator?.return?.()
    }
    const release = () => {
      if (readerReleased) return
      try {
        reader?.releaseLock()
        readerReleased = true
      } catch {
        // Cleanup must not replace the provider outcome.
      }
    }

    let interaction: RecordValue | undefined
    let latestUsage: RecordValue | undefined
    let finalUsage: RecordValue | undefined
    let error: unknown
    let firstTokenTime: number | undefined
    const steps = new Map<number, StreamStep>()
    let completed = false
    let closed = false
    let cancelled = false
    let captured = false

    const observe = (event: InteractionEvent) => {
      let schemaError: Error | undefined
      try {
        const item = record(event)
        const eventType = item?.event_type
        if (
          eventType === 'interaction.start' ||
          eventType === 'interaction.complete' ||
          eventType === 'interaction.delta' ||
          (typeof eventType === 'string' && eventType.startsWith('content.'))
        ) {
          schemaError = new Error('Gemini Interactions GA schema requires @google/genai 2.18.0 or newer')
        } else {
          // These are cumulative interaction snapshots, not per-step increments.
          // step_usage is deliberately excluded: it is not a request-wide total.
          const usage =
            record(record(item?.metadata)?.total_usage) ?? (eventType === 'step.stop' ? record(item?.usage) : undefined)
          if (usage) latestUsage = { ...usage }

          if (eventType === 'interaction.created') {
            interaction = { ...record(item?.interaction) }
            const initialUsage = record(interaction.usage)
            if (initialUsage) latestUsage = { ...initialUsage }
          } else if (eventType === 'step.start') {
            const index = number(item?.index)
            const step = record(item?.step)
            if (index !== undefined)
              steps.set(index, {
                ...step,
                content: Array.isArray(step?.content) ? step.content.map((item) => ({ ...record(item) })) : [],
              })
          } else if (eventType === 'step.delta') {
            const index = number(item?.index)
            const delta = record(item?.delta)
            const step = index === undefined ? undefined : steps.get(index)
            if (step && delta?.type === 'text' && typeof delta.text === 'string') {
              const last = step.content?.at(-1)
              const text = record(last)
              if (text?.type === 'text') text.text = `${text.text ?? ''}${delta.text}`
              else step.content?.push({ type: 'text', text: delta.text })
              firstTokenTime ??= Date.now()
            } else if (step && delta?.type === 'arguments_delta' && typeof delta.arguments === 'string') {
              step.argumentChunks = `${step.argumentChunks ?? ''}${delta.arguments}`
              firstTokenTime ??= Date.now()
            }
          } else if (eventType === 'interaction.completed') {
            const result = record(item?.interaction)
            interaction = { ...interaction, ...result }
            completed = interaction.status !== 'queued' && interaction.status !== 'in_progress'
            const reportedUsage = record(result?.usage)
            if (reportedUsage) {
              latestUsage = { ...reportedUsage }
              if (completed) finalUsage = latestUsage
            }
            if (isFailure(interaction.status)) error = new Error(`Gemini interaction ${interaction.status}`)
            if (!completed) error = new Error('Gemini interaction stream ended without a terminal result')
          } else if (eventType === 'error') {
            error = new Error('Gemini interaction stream failed')
          }
        }
      } catch {
        // Observing an event must not prevent the caller from receiving it.
      }
      // Unsupported provider schemas are intentional API errors, not telemetry failures.
      if (schemaError) throw schemaError
    }

    const finish = async (status: 'incomplete' | 'cancelled' | 'failed', providerError?: unknown) => {
      if (captured) return
      captured = true
      try {
        const streamedSteps = [...steps.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, step]) => ({
            ...step,
            arguments: step.argumentChunks === undefined ? step.arguments : functionArguments(step.argumentChunks),
          }))
        const output = outputFromSteps(
          Array.isArray(interaction?.steps) && interaction.steps.length > 0 ? interaction.steps : streamedSteps
        )
        await capture(
          {
            ...interaction,
            usage: finalUsage ?? latestUsage,
            ...(completed ? {} : { status }),
          },
          providerError ??
            error ??
            (!completed && status === 'incomplete'
              ? new Error('Gemini interaction stream ended without completion')
              : undefined),
          output,
          firstTokenTime
        )
      } catch {
        // Final telemetry preparation must not replace an error, completion, or cancellation.
      }
    }

    return new ReadableStream<InteractionEvent>({
      async pull(controller) {
        try {
          const result = await next()
          if (closed) return
          if (result.done) {
            closed = true
            await finish('incomplete')
            release()
            if (!cancelled) controller.close()
          } else {
            observe(result.value)
            controller.enqueue(result.value)
          }
        } catch (providerError) {
          if (closed) return
          closed = true
          try {
            await cancelSource(providerError)
          } catch {
            // Preserve the original provider/schema error if cleanup also fails.
          }
          await finish('failed', providerError)
          release()
          if (!cancelled) controller.error(providerError)
        }
      },
      async cancel(reason) {
        cancelled = true
        if (closed) return
        closed = true
        let cancellationError: unknown
        try {
          await cancelSource(reason)
        } catch (providerError) {
          cancellationError = providerError
          throw providerError
        } finally {
          await finish('cancelled', cancellationError)
          release()
        }
      },
    }) as ReadableStream<InteractionEvent> & AsyncIterable<InteractionEvent>
  }
}
