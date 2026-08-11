import type { LoggerFn } from './logger'
import { log } from './logger'
import type { AnalyticsInjectableJsonSchema } from './analytics-parameters'

/**
 * Mirrors the `conversation_id` session handle into `structuredContent`, in two
 * halves that must stay in that order:
 *
 *   1. declare `_conversation` on the tool's advertised `outputSchema`
 *   2. write it into the result's `structuredContent`
 *
 * Needed because clients that read `structuredContent` — which they do whenever
 * a tool declares an `outputSchema` — never see the `content` text block that
 * carries the handle (ADR-0004).
 *
 * The declaration is what makes the write safe. The MCP client ajv-validates
 * `structuredContent` against the schema from `tools/list`, and
 * `zod-to-json-schema` emits `additionalProperties: false` for a plain
 * `z.object`, so an undeclared key is not ignored — it fails the entire tool
 * result. Only tools that got the declaration are ever written to.
 *
 * What rides here is *state*, never an instruction. A tool result is untrusted
 * input, and a payload that tells the agent what to do reads as a prompt
 * injection — which clients are right to refuse. The "carry this value forward"
 * guidance lives in the schema descriptions the client fetched at `tools/list`.
 * See ADR-0010.
 */
export const CONVERSATION_STATE_KEY = '_conversation'

const CONVERSATION_STATE_FIELD_DESCRIPTION =
  "Conversation state issued by this server, alongside this tool's own output."

// Schema, so it directs the agent as strictly as the input parameter does — same
// trusted channel, same rules, and the client read both at `tools/list`. Only the
// original's "on every subsequent tool call" is gone: a tool whose schema is composed
// (`oneOf`/`allOf`/`anyOf`/`$ref`) never had `conversation_id` injected and rejects
// it, so the universal was a promise this SDK cannot keep. See ADR-0010.
const CONVERSATION_ID_FIELD_DESCRIPTION =
  'Echo this exact value as the conversation_id argument on subsequent tool calls that declare one — never invent a value.'

export interface ConversationStateInjectableTool {
  name?: string
  outputSchema?: unknown
  [key: string]: unknown
}

/**
 * True when we can safely declare {@link CONVERSATION_STATE_KEY} on this tool's
 * advertised output schema.
 *
 * Requires a plain-object schema we can extend. A tool with no `outputSchema`
 * has nothing to mirror into and keeps working through `content`; a composed
 * schema (`oneOf`/`allOf`/`anyOf`/`$ref`) has no single `properties` bag to add
 * to. Both stay content-only, matching the policy on the input side.
 */
export function canDeclareConversationState(outputSchema: unknown): boolean {
  if (!outputSchema || typeof outputSchema !== 'object') {
    return false
  }

  // Only the JSON Schema a tool advertises can answer this. A Zod schema or raw
  // shape — what the high-level registry stores — has no `properties` bag, so
  // every check below would pass vacuously and report `true` for a tool whose
  // schema we actually skipped. Refuse rather than guess: callers holding a Zod
  // value must read the recorded answer off the ownership registry instead.
  if (isSchemaObjectLike(outputSchema)) {
    return false
  }

  const schema = outputSchema as AnalyticsInjectableJsonSchema
  if (schema.$ref || schema.oneOf || schema.allOf || schema.anyOf) {
    return false
  }

  // `properties` must be a plain object if it is present at all. A tool that
  // advertises something else is malformed, and harmlessly so until we try to
  // declare into it — assigning a key to a boolean throws, and that throw
  // surfaces inside the `tools/list` wrapper, failing the entire listing over a
  // schema we only wanted to annotate.
  const { properties } = schema
  if (
    properties !== undefined &&
    (typeof properties !== 'object' || properties === null || Array.isArray(properties))
  ) {
    return false
  }
  return !properties || !Object.prototype.hasOwnProperty.call(properties, CONVERSATION_STATE_KEY)
}

/** A single Zod schema — the internals every version brands its instances with. */
function isZodLike(entry: unknown): boolean {
  return !!entry && typeof entry === 'object' && ('_def' in entry || '_zod' in entry || '~standard' in entry)
}

/**
 * Whether this is a JSON Schema, judged on the *value* of each marker rather
 * than the key alone — a raw Zod shape is free to name a field `type` or
 * `properties`, but its values are Zod schemas, not a string and a property bag.
 */
function looksLikeJsonSchema(candidate: Record<string, unknown>): boolean {
  if (typeof candidate.type === 'string' || typeof candidate.$ref === 'string') {
    return true
  }
  if (Array.isArray(candidate.oneOf) || Array.isArray(candidate.allOf) || Array.isArray(candidate.anyOf)) {
    return true
  }
  const { properties } = candidate
  return !!properties && typeof properties === 'object' && !isZodLike(properties)
}

/** A Zod schema, or a raw shape whose values are Zod schemas. */
function isSchemaObjectLike(value: unknown): boolean {
  const candidate = value as Record<string, unknown>
  if (isZodLike(candidate)) {
    return true
  }

  // Settle "is this a JSON Schema" before scanning the values, because a schema
  // may legitimately declare a property named `_def` — and the scan below would
  // read that property's schema object as a Zod value and skip a tool we could
  // have annotated perfectly well.
  if (looksLikeJsonSchema(candidate)) {
    return false
  }
  return Object.values(candidate).some(isZodLike)
}

/**
 * Returns a copy of the tool with an optional {@link CONVERSATION_STATE_KEY}
 * property added to its output schema, or the tool untouched when it has no
 * output schema to extend.
 *
 * The property is never added to `required` — a result without it must stay
 * valid, since every tool result predating this change lacks it.
 */
export function addConversationStateToOutputSchema<TTool extends ConversationStateInjectableTool>(
  tool: TTool,
  logger: LoggerFn = log
): TTool {
  const toolName = tool.name || 'unknown'
  const original = tool.outputSchema

  // No output schema means the client reads `content`, where the session handle already
  // rides. Nothing to declare, and nothing broken.
  if (!original || typeof original !== 'object') {
    return tool
  }

  if (!canDeclareConversationState(original)) {
    const schema = original as AnalyticsInjectableJsonSchema
    if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, CONVERSATION_STATE_KEY)) {
      logger(
        `WARN: Tool "${toolName}" already declares '${CONVERSATION_STATE_KEY}' in its output schema. Leaving it alone.`
      )
    } else {
      logger(
        `WARN: Tool "${toolName}" has a complex output schema (oneOf/allOf/anyOf/$ref). Skipping '${CONVERSATION_STATE_KEY}' declaration; its session handle stays content-only.`
      )
    }
    return tool
  }

  const modifiedTool = { ...tool }
  // Deep copy: the server may reuse or freeze the schema object it handed us.
  const outputSchema = JSON.parse(JSON.stringify(original)) as AnalyticsInjectableJsonSchema

  if (!outputSchema.properties) {
    outputSchema.properties = {}
  }

  outputSchema.properties[CONVERSATION_STATE_KEY] = {
    type: 'object',
    description: CONVERSATION_STATE_FIELD_DESCRIPTION,
    properties: {
      conversation_id: {
        type: 'string',
        description: CONVERSATION_ID_FIELD_DESCRIPTION,
      },
    },
  }

  modifiedTool.outputSchema = outputSchema
  return modifiedTool
}

/**
 * Declares {@link CONVERSATION_STATE_KEY} across a tool listing. Tools without an
 * output schema, and tools whose schema we cannot extend, pass through unchanged.
 */
export function addConversationStateToOutputSchemas<TTool extends ConversationStateInjectableTool>(
  tools: TTool[],
  logger: LoggerFn = log
): TTool[] {
  return tools.map((tool) => addConversationStateToOutputSchema(tool, logger))
}

export interface ConversationState {
  conversation_id: string
}

/** The payload mirrored into `structuredContent` for a tool we declared the key on. */
export function buildConversationState(conversationId: string): ConversationState {
  return { conversation_id: conversationId }
}

/**
 * Adds {@link CONVERSATION_STATE_KEY} to a result's `structuredContent`, which is
 * where clients look once a tool declares an `outputSchema` — the `content` text
 * block carrying the session handle is invisible to them.
 *
 * Unlike the text block, this rides *every* response rather than only the one
 * that minted the session handle, so an agent that drops it can read it back.
 *
 * Returns the result untouched when there is no plain-object `structuredContent`
 * to extend, or when the tool already produced its own key — customer data wins.
 * Never mutates the input.
 */
export function mirrorConversationStateIntoStructuredContent(result: unknown, conversationId: string): unknown {
  if (!result || typeof result !== 'object') {
    return result
  }
  const structuredContent = (result as { structuredContent?: unknown }).structuredContent
  if (!structuredContent || typeof structuredContent !== 'object' || Array.isArray(structuredContent)) {
    return result
  }
  if (Object.prototype.hasOwnProperty.call(structuredContent, CONVERSATION_STATE_KEY)) {
    return result
  }
  return {
    ...result,
    structuredContent: {
      ...structuredContent,
      [CONVERSATION_STATE_KEY]: buildConversationState(conversationId),
    },
  }
}
