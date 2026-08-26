import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type { ChatGeneration, LLMResult } from '@langchain/core/outputs'
import type { Serialized } from '@langchain/core/load/serializable'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import { extendInteropZodObject, type InteropZodObject } from '@langchain/core/utils/types'
import { createMiddleware } from 'langchain'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { isObject } from '../../typeGuards'
import { toContentString } from '../../utils'
import { LangChainCallbackHandler, LangChainCallbackHandlerOptions } from '../callbacks'

const postHogStateSchema = z.object({
  _posthogRunId: z.string().optional(),
  _posthogStartTime: z.number().optional(),
  _posthogInput: z.record(z.string(), z.unknown()).optional(),
})

type PostHogState = z.infer<typeof postHogStateSchema>

class LangChainMiddlewareCallbackHandler extends LangChainCallbackHandler {
  protected override _getParentRunId(_traceId: string, _runId: string, parentRunId?: string): string | undefined {
    return parentRunId
  }
}

const withoutPostHogState = <T extends Record<string, unknown>>(state: T): Omit<T, keyof PostHogState> => {
  const { _posthogRunId: _, _posthogStartTime: __, _posthogInput: ___, ...rest } = state
  return rest
}

const getRunId = (state: PostHogState): string => state._posthogRunId ?? uuidv7()

const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    try {
      return String(value)
    } catch {
      return ''
    }
  }
}

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(stringify(error)))

const safely = (callback: () => void): void => {
  try {
    callback()
  } catch {
    // Telemetry must never affect the LangChain middleware lifecycle.
  }
}

const serializeModel = (model: unknown): Serialized => {
  if (model && typeof model === 'object' && 'toJSON' in model && typeof model.toJSON === 'function') {
    try {
      return model.toJSON() as Serialized
    } catch {
      // Fall back to a minimal LangChain serialization below.
    }
  }

  return { lc: 1, type: 'constructor', id: ['langchain', 'chat_models', 'unknown'], kwargs: {} }
}

const toModelOptions = (modelSettings: unknown): Record<string, unknown> => {
  if (!isObject(modelSettings)) {
    return {}
  }
  try {
    return { ...modelSettings }
  } catch {
    return {}
  }
}

const getModelMetadata = (model: unknown, modelSettings: unknown): Record<string, unknown> | undefined => {
  if (model && typeof model === 'object' && 'getLsParams' in model && typeof model.getLsParams === 'function') {
    try {
      return model.getLsParams(toModelOptions(modelSettings)) as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  return undefined
}

const getModelInvocationParams = (model: unknown, modelSettings: unknown): Record<string, unknown> => {
  const options = toModelOptions(modelSettings)
  if (
    model &&
    typeof model === 'object' &&
    'invocationParams' in model &&
    typeof model.invocationParams === 'function'
  ) {
    try {
      const params = model.invocationParams(options)
      if (isObject(params)) {
        return { ...options, ...params }
      }
    } catch {
      // Preserve the bind-time settings when the model cannot expose invocation parameters.
    }
  }
  return options
}

const normalizeTools = (tools: readonly unknown[]): unknown[] => {
  return tools.map((tool) => {
    try {
      return convertToOpenAITool(tool as Parameters<typeof convertToOpenAITool>[0])
    } catch {
      return tool
    }
  })
}

const toLLMResult = (response: unknown): LLMResult => {
  if (!AIMessage.isInstance(response)) {
    return { generations: [] }
  }

  const generation: ChatGeneration = {
    text: toContentString(response.content),
    message: response,
  }
  return { generations: [[generation]] }
}

/** Options shared with the LangChain callback integration. */
export type PostHogLangChainMiddlewareOptions = LangChainCallbackHandlerOptions & {
  /** The custom Zod state schema supplied to `createAgent`, included in captured trace state. */
  stateSchema?: InteropZodObject
}

/**
 * Creates PostHog AI observability middleware for LangChain v1 agents.
 *
 * Use either this middleware or `LangChainCallbackHandler`, not both, to avoid
 * capturing the same model and tool calls twice.
 *
 * LangChain only invokes `afterAgent` for completed runs. A terminal agent
 * failure still captures the failed model or tool call, but not a root trace.
 */
export const createPostHogMiddleware = (options: PostHogLangChainMiddlewareOptions) => {
  const { stateSchema, ...callbackOptions } = options
  const callback = new LangChainMiddlewareCallbackHandler(callbackOptions)
  const middlewareStateSchema = stateSchema
    ? extendInteropZodObject(stateSchema, postHogStateSchema.shape)
    : postHogStateSchema

  return createMiddleware({
    name: 'PostHogMiddleware',
    stateSchema: middlewareStateSchema,

    beforeAgent: (state) => {
      return {
        _posthogRunId: uuidv7(),
        _posthogStartTime: Date.now(),
        _posthogInput: withoutPostHogState(state),
      }
    },

    afterAgent: (state) => {
      safely(() => {
        const runId = getRunId(state)
        callback.handleChainStart(
          { lc: 1, type: 'constructor', id: ['langchain', 'agents', 'PostHogMiddleware'], kwargs: {} },
          state._posthogInput ?? withoutPostHogState(state),
          runId,
          undefined,
          undefined,
          undefined,
          undefined,
          'LangChain Agent',
          { posthogStartTime: state._posthogStartTime }
        )
        callback.handleChainEnd(withoutPostHogState(state), runId)
      })
    },

    wrapModelCall: async (request, handler) => {
      const runId = uuidv7()
      const parentRunId = getRunId(request.state)
      const messages =
        request.systemMessage.text === '' ? request.messages : [request.systemMessage, ...request.messages]
      const invocationParams = {
        ...getModelInvocationParams(request.model, request.modelSettings),
        tools: normalizeTools(request.tools),
      }

      safely(() =>
        callback.handleChatModelStart(
          serializeModel(request.model),
          [messages],
          runId,
          parentRunId,
          { invocation_params: invocationParams },
          undefined,
          getModelMetadata(request.model, request.modelSettings)
        )
      )

      try {
        const response = await handler(request)
        safely(() => callback.handleLLMEnd(toLLMResult(response), runId, parentRunId))
        return response
      } catch (error) {
        safely(() => callback.handleLLMError(toError(error), runId, parentRunId))
        throw error
      }
    },

    wrapToolCall: async (request, handler) => {
      const runId = uuidv7()
      const parentRunId = getRunId(request.state)
      const toolName = String(request.tool?.name ?? request.toolCall.name)
      const serializedTool: Serialized = {
        lc: 1,
        type: 'constructor',
        id: ['langchain', 'tools', toolName],
        kwargs: {},
      }

      safely(() =>
        callback.handleToolStart(
          serializedTool,
          stringify(request.toolCall.args),
          runId,
          parentRunId,
          undefined,
          undefined,
          toolName
        )
      )

      try {
        const result = await handler(request)
        if (ToolMessage.isInstance(result) && result.status === 'error') {
          safely(() => callback.handleToolError(new Error(toContentString(result.content)), runId, parentRunId))
        } else {
          safely(() => callback.handleToolEnd(result, runId, parentRunId))
        }
        return result
      } catch (error) {
        safely(() => callback.handleToolError(toError(error), runId, parentRunId))
        throw error
      }
    },
  })
}
