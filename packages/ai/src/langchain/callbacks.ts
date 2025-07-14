import { PostHog } from 'posthog-node'
import { withPrivacyMode, getModelParams } from '../utils'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { Serialized } from '@langchain/core/load/serializable'
import type { ChainValues } from '@langchain/core/utils/types'
import type { BaseMessage } from '@langchain/core/messages'
import type { LLMResult } from '@langchain/core/outputs'
import type { AgentAction, AgentFinish } from '@langchain/core/agents'
import type { DocumentInterface } from '@langchain/core/documents'

interface SpanMetadata {
  /** Name of the trace/span (e.g. chain name) */
  name: string
  /** Timestamp (in ms) when the run started */
  startTime: number
  /** Timestamp (in ms) when the run ended (if already finished) */
  endTime?: number
  /** The input state */
  input?: any
}

interface GenerationMetadata extends SpanMetadata {
  /** Provider used (e.g. openai, anthropic) */
  provider?: string
  /** Model name used in the generation */
  model?: string
  /** The model parameters (temperature, max_tokens, etc.) */
  modelParams?: Record<string, any>
  /** The base URL—for example, the API base used */
  baseUrl?: string
  /** The tools used in the generation */
  tools?: Record<string, any>
}

/** A run may either be a Span or a Generation */
type RunMetadata = SpanMetadata | GenerationMetadata

/** Storage for run metadata */
type RunMetadataStorage = { [runId: string]: RunMetadata }

export class LangChainCallbackHandler extends BaseCallbackHandler {
  public name = 'PosthogCallbackHandler'
  private client: PostHog
  private distinctId?: string | number
  private traceId?: string | number
  private properties: Record<string, any>
  private privacyMode: boolean
  private groups: Record<string, any>
  private debug: boolean

  private runs: RunMetadataStorage = {}
  private parentTree: { [runId: string]: string } = {}

  constructor(options: {
    client: PostHog
    distinctId?: string | number
    traceId?: string | number
    properties?: Record<string, any>
    privacyMode?: boolean
    groups?: Record<string, any>
    debug?: boolean
  }) {
    if (!options.client) {
      throw new Error('PostHog client is required')
    }
    super()
    this.client = options.client
    this.distinctId = options.distinctId
    this.traceId = options.traceId
    this.properties = options.properties || {}
    this.privacyMode = options.privacyMode || false
    this.groups = options.groups || {}
    this.debug = options.debug || false
  }

  // ===== CALLBACK METHODS =====

  public handleChainStart(
    chain: Serialized,
    inputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    runName?: string
  ): void {
    this._logDebugEvent('on_chain_start', runId, parentRunId, { inputs, tags })
    this._setParentOfRun(runId, parentRunId)
    this._setTraceOrSpanMetadata(chain, inputs, runId, parentRunId, metadata, tags, runName)
  }

  public handleChainEnd(
    outputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    kwargs?: { inputs?: Record<string, unknown> }
  ): void {
    this._logDebugEvent('on_chain_end', runId, parentRunId, { outputs, tags })
    this._popRunAndCaptureTraceOrSpan(runId, parentRunId, outputs)
  }

  public handleChainError(
    error: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    kwargs?: { inputs?: Record<string, unknown> }
  ): void {
    this._logDebugEvent('on_chain_error', runId, parentRunId, { error, tags })
    this._popRunAndCaptureTraceOrSpan(runId, parentRunId, error)
  }

  public handleChatModelStart(
    serialized: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): void {
    this._logDebugEvent('on_chat_model_start', runId, parentRunId, { messages, tags })
    this._setParentOfRun(runId, parentRunId)
    // Flatten the two-dimensional messages and convert each message to a plain object
    const input = messages.flat().map((m) => this._convertMessageToDict(m))
    this._setLLMMetadata(serialized, runId, input, metadata, extraParams, runName)
  }

  public handleLLMStart(
    serialized: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): void {
    this._logDebugEvent('on_llm_start', runId, parentRunId, { prompts, tags })
    this._setParentOfRun(runId, parentRunId)
    this._setLLMMetadata(serialized, runId, prompts, metadata, extraParams, runName)
  }

  public handleLLMEnd(
    output: LLMResult,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    extraParams?: Record<string, unknown>
  ): void {
    this._logDebugEvent('on_llm_end', runId, parentRunId, { output, tags })
    this._popRunAndCaptureGeneration(runId, parentRunId, output)
  }

  public handleLLMError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    extraParams?: Record<string, unknown>
  ): void {
    this._logDebugEvent('on_llm_error', runId, parentRunId, { err, tags })
    this._popRunAndCaptureGeneration(runId, parentRunId, err)
  }

  public handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): void {
    this._logDebugEvent('on_tool_start', runId, parentRunId, { input, tags })
    this._setParentOfRun(runId, parentRunId)
    this._setTraceOrSpanMetadata(tool, input, runId, parentRunId, metadata, tags, runName)
  }

  public handleToolEnd(output: any, runId: string, parentRunId?: string, tags?: string[]): void {
    this._logDebugEvent('on_tool_end', runId, parentRunId, { output, tags })
    this._popRunAndCaptureTraceOrSpan(runId, parentRunId, output)
  }

  public handleToolError(err: Error, runId: string, parentRunId?: string, tags?: string[]): void {
    this._logDebugEvent('on_tool_error', runId, parentRunId, { err, tags })
    this._popRunAndCaptureTraceOrSpan(runId, parentRunId, err)
  }

  public handleRetrieverStart(
    retriever: Serialized,
    query: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string
  ): void {
    this._logDebugEvent('on_retriever_start', runId, parentRunId, { query, tags })
    this._setParentOfRun(runId, parentRunId)
    this._setTraceOrSpanMetadata(retriever, query, runId, parentRunId, metadata, tags, name)
  }

  public handleRetrieverEnd(
    documents: DocumentInterface[],
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): void {
    this._logDebugEvent('on_retriever_end', runId, parentRunId, { documents, tags })
    this._popRunAndCaptureTraceOrSpan(runId, parentRunId, documents)
  }

  public handleRetrieverError(err: Error, runId: string, parentRunId?: string, tags?: string[]): void {
    this._logDebugEvent('on_retriever_error', runId, parentRunId, { err, tags })
    this._popRunAndCaptureTraceOrSpan(runId, parentRunId, err)
  }

  public handleAgentAction(action: AgentAction, runId: string, parentRunId?: string, tags?: string[]): void {
    this._logDebugEvent('on_agent_action', runId, parentRunId, { action, tags })
    this._setParentOfRun(runId, parentRunId)
    this._setTraceOrSpanMetadata(null, action, runId, parentRunId)
  }

  public handleAgentEnd(action: AgentFinish, runId: string, parentRunId?: string, tags?: string[]): void {
    this._logDebugEvent('on_agent_finish', runId, parentRunId, { action, tags })
    this._popRunAndCaptureTraceOrSpan(runId, parentRunId, action)
  }

  // ===== PRIVATE HELPERS =====

  private _setParentOfRun(runId: string, parentRunId?: string): void {
    if (parentRunId) {
      this.parentTree[runId] = parentRunId
    }
  }

  private _popParentOfRun(runId: string): void {
    delete this.parentTree[runId]
  }

  private _findRootRun(runId: string): string {
    let id = runId
    while (this.parentTree[id]) {
      id = this.parentTree[id]
    }
    return id
  }

  private _setTraceOrSpanMetadata(
    serialized: any,
    input: any,
    runId: string,
    parentRunId?: string,
    ...args: any[]
  ): void {
    // Use default names if not provided: if this is a top-level run, we mark it as a trace, otherwise as a span.
    const defaultName = parentRunId ? 'span' : 'trace'
    const runName = this._getLangchainRunName(serialized, ...args) || defaultName
    this.runs[runId] = {
      name: runName,
      input,
      startTime: Date.now(),
    } as SpanMetadata
  }

  private _setLLMMetadata(
    serialized: Serialized | null,
    runId: string,
    messages: any,
    metadata?: any,
    extraParams?: any,
    runName?: string
  ): void {
    const runNameFound = this._getLangchainRunName(serialized, { extraParams, runName }) || 'generation'
    const generation: GenerationMetadata = {
      name: runNameFound,
      input: messages,
      startTime: Date.now(),
    }
    if (extraParams) {
      generation.modelParams = getModelParams(extraParams.invocation_params)
    }
    if (metadata) {
      if (metadata.ls_model_name) {
        generation.model = metadata.ls_model_name
      }
      if (metadata.ls_provider) {
        generation.provider = metadata.ls_provider
      }
    }
    if (serialized && 'kwargs' in serialized && serialized.kwargs.openai_api_base) {
      generation.baseUrl = serialized.kwargs.openai_api_base
    }
    this.runs[runId] = generation
  }

  private _popRunMetadata(runId: string): RunMetadata | undefined {
    const endTime = Date.now()
    const run = this.runs[runId]
    if (!run) {
      console.warn(`No run metadata found for run ${runId}`)
      return undefined
    }
    run.endTime = endTime
    delete this.runs[runId]
    return run
  }

  private _getTraceId(runId: string): string {
    return this.traceId ? String(this.traceId) : this._findRootRun(runId)
  }

  private _getParentRunId(traceId: string, runId: string, parentRunId?: string): string | undefined {
    // Replace the parent-run if not found in our stored parent tree.
    if (parentRunId && !this.parentTree[parentRunId]) {
      return traceId
    }
    return parentRunId
  }

  private _popRunAndCaptureTraceOrSpan(
    runId: string,
    parentRunId: string | undefined,
    outputs: ChainValues | DocumentInterface[] | AgentFinish | Error | any
  ): void {
    const traceId = this._getTraceId(runId)
    this._popParentOfRun(runId)
    const run = this._popRunMetadata(runId)
    if (!run) {
      return
    }
    if ('modelParams' in run) {
      console.warn(`Run ${runId} is a generation, but attempted to be captured as a trace/span.`)
      return
    }
    const actualParentRunId = this._getParentRunId(traceId, runId, parentRunId)
    this._captureTraceOrSpan(traceId, runId, run as SpanMetadata, outputs, actualParentRunId)
  }

  private _captureTraceOrSpan(
    traceId: string,
    runId: string,
    run: SpanMetadata,
    outputs: ChainValues | DocumentInterface[] | AgentFinish | Error | any,
    parentRunId?: string
  ): void {
    const eventName = parentRunId ? '$ai_span' : '$ai_trace'
    const latency = run.endTime ? (run.endTime - run.startTime) / 1000 : 0
    const eventProperties: Record<string, any> = {
      $ai_trace_id: traceId,
      $ai_input_state: withPrivacyMode(this.client, this.privacyMode, run.input),
      $ai_latency: latency,
      $ai_span_name: run.name,
      $ai_span_id: runId,
    }
    if (parentRunId) {
      eventProperties['$ai_parent_id'] = parentRunId
    }

    Object.assign(eventProperties, this.properties)
    if (!this.distinctId) {
      eventProperties['$process_person_profile'] = false
    }
    if (outputs instanceof Error) {
      eventProperties['$ai_error'] = outputs.toString()
      eventProperties['$ai_is_error'] = true
    } else if (outputs !== undefined) {
      eventProperties['$ai_output_state'] = withPrivacyMode(this.client, this.privacyMode, outputs)
    }
    this.client.capture({
      distinctId: this.distinctId ? this.distinctId.toString() : runId,
      event: eventName,
      properties: eventProperties,
      groups: this.groups,
    })
  }

  private _popRunAndCaptureGeneration(
    runId: string,
    parentRunId: string | undefined,
    response: LLMResult | Error
  ): void {
    const traceId = this._getTraceId(runId)
    this._popParentOfRun(runId)
    const run = this._popRunMetadata(runId)
    if (!run || typeof run !== 'object' || !('modelParams' in run)) {
      console.warn(`Run ${runId} is not a generation, but attempted to be captured as such.`)
      return
    }
    const actualParentRunId = this._getParentRunId(traceId, runId, parentRunId)
    this._captureGeneration(traceId, runId, run as GenerationMetadata, response, actualParentRunId)
  }

  private _captureGeneration(
    traceId: string,
    runId: string,
    run: GenerationMetadata,
    output: LLMResult | Error,
    parentRunId?: string
  ): void {
    const latency = run.endTime ? (run.endTime - run.startTime) / 1000 : 0
    const eventProperties: Record<string, any> = {
      $ai_trace_id: traceId,
      $ai_span_id: runId,
      $ai_span_name: run.name,
      $ai_parent_id: parentRunId,
      $ai_provider: run.provider,
      $ai_model: run.model,
      $ai_model_parameters: run.modelParams,
      $ai_input: withPrivacyMode(this.client, this.privacyMode, run.input),
      $ai_http_status: 200,
      $ai_latency: latency,
      $ai_base_url: run.baseUrl,
    }

    if (run.tools) {
      eventProperties['$ai_tools'] = withPrivacyMode(this.client, this.privacyMode, run.tools)
    }

    if (output instanceof Error) {
      eventProperties['$ai_http_status'] = (output as any).status || 500
      eventProperties['$ai_error'] = output.toString()
      eventProperties['$ai_is_error'] = true
    } else {
      // Handle token usage
      const [inputTokens, outputTokens, additionalTokenData] = this.parseUsage(output)
      eventProperties['$ai_input_tokens'] = inputTokens
      eventProperties['$ai_output_tokens'] = outputTokens

      // Add additional token data to properties
      if (additionalTokenData.cacheReadInputTokens) {
        eventProperties['$ai_cache_read_tokens'] = additionalTokenData.cacheReadInputTokens
      }
      if (additionalTokenData.reasoningTokens) {
        eventProperties['$ai_reasoning_tokens'] = additionalTokenData.reasoningTokens
      }

      // Handle generations/completions
      let completions
      if (output.generations && Array.isArray(output.generations)) {
        const lastGeneration = output.generations[output.generations.length - 1]
        if (Array.isArray(lastGeneration)) {
          completions = lastGeneration.map((gen) => {
            return { role: 'assistant', content: gen.text }
          })
        }
      }

      if (completions) {
        eventProperties['$ai_output_choices'] = withPrivacyMode(this.client, this.privacyMode, completions)
      }
    }

    Object.assign(eventProperties, this.properties)
    if (!this.distinctId) {
      eventProperties['$process_person_profile'] = false
    }

    this.client.capture({
      distinctId: this.distinctId ? this.distinctId.toString() : traceId,
      event: '$ai_generation',
      properties: eventProperties,
      groups: this.groups,
    })
  }

  private _logDebugEvent(eventName: string, runId: string, parentRunId: string | undefined, extra: any): void {
    if (this.debug) {
      console.log(`Event: ${eventName}, runId: ${runId}, parentRunId: ${parentRunId}, extra:`, extra)
    }
  }

  private _getLangchainRunName(serialized: any, ...args: any): string | undefined {
    if (args && args.length > 0) {
      for (const arg of args) {
        if (arg && typeof arg === 'object' && 'name' in arg) {
          return arg.name
        } else if (arg && typeof arg === 'object' && 'runName' in arg) {
          return arg.runName
        }
      }
    }

    if (serialized && serialized.name) {
      return serialized.name
    }
    if (serialized && serialized.id) {
      return Array.isArray(serialized.id) ? serialized.id[serialized.id.length - 1] : serialized.id
    }
    return undefined
  }

  private _convertMessageToDict(message: any): Record<string, any> {
    let messageDict: Record<string, any> = {}

    // Check the _getType() method or type property instead of instanceof
    const messageType = message._getType?.() || message.type

    switch (messageType) {
      case 'human':
        messageDict = { role: 'user', content: message.content }
        break
      case 'ai':
        messageDict = { role: 'assistant', content: message.content }
        break
      case 'system':
        messageDict = { role: 'system', content: message.content }
        break
      case 'tool':
        messageDict = { role: 'tool', content: message.content }
        break
      case 'function':
        messageDict = { role: 'function', content: message.content }
        break
      default:
        messageDict = { role: messageType || 'unknown', content: String(message.content) }
    }

    if (message.additional_kwargs) {
      messageDict = { ...messageDict, ...message.additional_kwargs }
    }
    return messageDict
  }

  private _parseUsageModel(usage: any): [number, number, Record<string, any>] {
    const conversionList: Array<[string, 'input' | 'output']> = [
      ['promptTokens', 'input'],
      ['completionTokens', 'output'],
      ['input_tokens', 'input'],
      ['output_tokens', 'output'],
      ['prompt_token_count', 'input'],
      ['candidates_token_count', 'output'],
      ['inputTokenCount', 'input'],
      ['outputTokenCount', 'output'],
      ['input_token_count', 'input'],
      ['generated_token_count', 'output'],
    ]

    const parsedUsage = conversionList.reduce(
      (acc: { input: number; output: number }, [modelKey, typeKey]) => {
        const value = usage[modelKey]
        if (value != null) {
          const finalCount = Array.isArray(value)
            ? value.reduce((sum: number, tokenCount: number) => sum + tokenCount, 0)
            : value
          acc[typeKey] = finalCount
        }
        return acc
      },
      { input: 0, output: 0 }
    )

    // Extract additional token details like cached tokens and reasoning tokens
    const additionalTokenData: Record<string, any> = {}

    // Check for cached tokens in various formats
    if (usage.prompt_tokens_details?.cached_tokens != null) {
      additionalTokenData.cacheReadInputTokens = usage.prompt_tokens_details.cached_tokens
    } else if (usage.input_token_details?.cache_read != null) {
      additionalTokenData.cacheReadInputTokens = usage.input_token_details.cache_read
    } else if (usage.cachedPromptTokens != null) {
      additionalTokenData.cacheReadInputTokens = usage.cachedPromptTokens
    }

    // Check for reasoning tokens in various formats
    if (usage.completion_tokens_details?.reasoning_tokens != null) {
      additionalTokenData.reasoningTokens = usage.completion_tokens_details.reasoning_tokens
    } else if (usage.output_token_details?.reasoning != null) {
      additionalTokenData.reasoningTokens = usage.output_token_details.reasoning
    } else if (usage.reasoningTokens != null) {
      additionalTokenData.reasoningTokens = usage.reasoningTokens
    }

    return [parsedUsage.input, parsedUsage.output, additionalTokenData]
  }

  private parseUsage(response: LLMResult): [number, number, Record<string, any>] {
    let llmUsage: [number, number, Record<string, any>] = [0, 0, {}]
    const llmUsageKeys = ['token_usage', 'usage', 'tokenUsage']

    if (response.llmOutput != null) {
      const key = llmUsageKeys.find((k) => response.llmOutput?.[k] != null)
      if (key) {
        llmUsage = this._parseUsageModel(response.llmOutput[key])
      }
    }

    // If top-level usage info was not found, try checking the generations.
    if (llmUsage[0] === 0 && llmUsage[1] === 0 && response.generations) {
      for (const generation of response.generations) {
        for (const genChunk of generation) {
          // Check other paths for usage information
          if (genChunk.generationInfo?.usage_metadata) {
            llmUsage = this._parseUsageModel(genChunk.generationInfo.usage_metadata)
            return llmUsage
          }

          const messageChunk = genChunk.generationInfo ?? {}
          const responseMetadata = messageChunk.response_metadata ?? {}
          const chunkUsage =
            responseMetadata['usage'] ??
            responseMetadata['amazon-bedrock-invocationMetrics'] ??
            messageChunk.usage_metadata
          if (chunkUsage) {
            llmUsage = this._parseUsageModel(chunkUsage)
            return llmUsage
          }
        }
      }
    }

    return llmUsage
  }
}
