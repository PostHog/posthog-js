import type { MCPAnalyticsModelSource, MCPAnalyticsOptions, MCPRequestLike, McpEvent } from '../types'
import { addAnalyticsParameterToTool, type AnalyticsInjectableJsonSchema } from './analytics-parameters'
import { DEFAULT_MODEL_PARAMETER_DESCRIPTION } from './constants'
import { log, type LoggerFn } from './logger'

/**
 * Model capture (`captureModel`).
 *
 * MCP does not standardize model identity. Some clients expose it through
 * vendor metadata, while other harnesses inject the model id into the system
 * prompt so the agent can state it like intent through the `context` parameter.
 *
 * This module injects a required `llm_model` string parameter into every tool
 * (mirroring `context-parameters.ts`), strips it before the tool runs, and
 * captures the best available value as `$mcp_llm_model`. Client metadata wins
 * over self-report, and `$mcp_llm_model_source` preserves that provenance.
 * Both sources are unverified — right for degradation analytics ("does our MCP
 * get worse on model X?"), never for billing or security.
 *
 * Reasoning effort is deliberately NOT captured: it never crosses the wire,
 * and models cannot reliably self-report it (harnesses apply it as a sampling
 * parameter the model never sees), so any captured value would be noise.
 */

export interface ModelInjectableTool {
  inputSchema?: AnalyticsInjectableJsonSchema
  name?: string
  [key: string]: unknown
}

/** Model capture is enabled unless explicitly disabled. */
export function isCaptureModelEnabled(captureModel: MCPAnalyticsOptions['captureModel']): boolean {
  return (
    captureModel === undefined || captureModel === true || (typeof captureModel === 'object' && captureModel !== null)
  )
}

export function getModelDescription(captureModel: MCPAnalyticsOptions['captureModel']): string | undefined {
  return typeof captureModel === 'object' && captureModel !== null ? captureModel.description : undefined
}

/**
 * Adds an `llm_model` parameter to a tool's JSON Schema, via the shared
 * injector so schema handling stays identical to `context`: a tool that already
 * declares `llm_model` owns it, and complex schemas can't safely gain keys.
 */
export function addModelParameterToTool<TTool extends ModelInjectableTool>(
  tool: TTool,
  modelDescriptionOverride?: string,
  logger: LoggerFn = log
): TTool {
  return addAnalyticsParameterToTool(
    tool,
    'llm_model',
    modelDescriptionOverride || DEFAULT_MODEL_PARAMETER_DESCRIPTION,
    'model',
    logger
  )
}

export function addModelParameterToTools<TTool extends ModelInjectableTool>(
  tools: TTool[],
  modelDescriptionOverride?: string,
  logger: LoggerFn = log
): TTool[] {
  return tools.map((tool) => addModelParameterToTool(tool, modelDescriptionOverride, logger))
}

/**
 * Reads the self-reported model off a tool-call request. Returns `undefined`
 * for a missing, blank, or `"unknown"` value — the parameter description asks
 * agents to pass `unknown` when uncertain, and an honest "I don't know" must
 * not become a property value queries would group by.
 */
export function getModelArgument(request: MCPRequestLike): string | undefined {
  return normalizeModel(request.params?.arguments?.llm_model)
}

const CODEX_TURN_METADATA_KEY = 'x-codex-turn-metadata'

export interface ResolvedModel {
  model: string
  source: MCPAnalyticsModelSource
}

/**
 * Resolves model identity from sources visible to an MCP server. The Codex
 * request metadata is host-generated and therefore more reliable than a model
 * filling an injected argument, but remains unverified client input.
 */
export function resolveModel(request: MCPRequestLike, allowSelfReported: boolean): ResolvedModel | undefined {
  const codexMetadata = request.params?._meta?.[CODEX_TURN_METADATA_KEY]
  if (isRecord(codexMetadata) && Object.prototype.hasOwnProperty.call(codexMetadata, 'model')) {
    const model = normalizeModel(codexMetadata.model)
    if (model) {
      return { model, source: 'client_metadata' }
    }
  }

  if (allowSelfReported) {
    const model = getModelArgument(request)
    if (model) {
      return { model, source: 'self_reported' }
    }
  }

  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeModel(model: unknown): string | undefined {
  if (typeof model !== 'string') {
    return undefined
  }
  const trimmed = model.trim()
  if (!trimmed || trimmed.toLowerCase() === 'unknown') {
    return undefined
  }
  return trimmed
}

export function setEventModel(
  event: McpEvent,
  model: string | undefined,
  source: MCPAnalyticsModelSource = 'self_reported'
): void {
  const normalizedModel = normalizeModel(model)
  if (!normalizedModel) {
    return
  }
  event.llmModel = normalizedModel
  event.llmModelSource = source
}
