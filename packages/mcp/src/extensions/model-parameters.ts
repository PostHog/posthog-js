import type { MCPAnalyticsOptions, MCPRequestLike, McpEvent } from '../types'
import { addAnalyticsParameterToTool, type AnalyticsInjectableJsonSchema } from './analytics-parameters'
import { DEFAULT_MODEL_PARAMETER_DESCRIPTION } from './constants'
import { log, type LoggerFn } from './logger'

/**
 * Self-reported model capture (`captureModel`).
 *
 * MCP keeps servers deliberately model-ignorant: the wire carries client
 * name/version and protocol version, never the LLM behind the client, and no
 * spec revision changes that. The one place the information exists on the
 * server side of the connection is the agent itself — harnesses inject the
 * model id into the system prompt, so the agent can state it the same way it
 * states its intent through the `context` parameter.
 *
 * This module injects a required `llm_model` string parameter into every tool
 * (mirroring `context-parameters.ts`), strips it before the tool runs, and
 * captures it as `$mcp_llm_model` with `$mcp_llm_model_source = "self_reported"`.
 * The source property is deliberate: like `clientInfo` in the MCP spec, the
 * value is self-reported and unverified — right for degradation analytics
 * ("does our MCP get worse on model X?"), never for billing or security.
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

/** Unlike `context`, model capture is opt-in: off unless explicitly enabled. */
export function isCaptureModelEnabled(captureModel: MCPAnalyticsOptions['captureModel']): boolean {
  return captureModel === true || (typeof captureModel === 'object' && captureModel !== null)
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
  const model = request.params?.arguments?.llm_model
  if (typeof model !== 'string') {
    return undefined
  }
  const trimmed = model.trim()
  if (!trimmed || trimmed.toLowerCase() === 'unknown') {
    return undefined
  }
  return trimmed
}

export function setEventModel(event: McpEvent, model: string | undefined): void {
  if (!model) {
    return
  }
  event.llmModel = model
  event.llmModelSource = 'self_reported'
}
