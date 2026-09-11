import type {
  CollectFeedbackOptions,
  FeedbackExtraPropertySchema,
  FeedbackReport,
  FeedbackSentiment,
  FeedbackType,
  CollectFeedbackConfig,
  CompatibleTextToolResult,
  CompatibleToolsListLike,
  JsonRecord,
} from '../types'
import { PostHogMCPAnalyticsProperty } from './constants'
import { log, type LoggerFn } from './logger'
import { sanitizeIntent, sanitizeIntentValue } from './mcp-payloads'

export const SEND_FEEDBACK_TOOL_NAME = 'send_feedback' as const

const FEEDBACK_TYPES: readonly FeedbackType[] = ['missing_capability', 'issue', 'praise', 'other']
const SENTIMENTS: readonly FeedbackSentiment[] = ['positive', 'neutral', 'negative', 'mixed']

// Free-text fields are agent-narrated, like `$mcp_intent`; bound them the same way.
const MAX_FEEDBACK_TEXT_LENGTH = 2048
const MAX_FEEDBACK_TOOL_NAME_LENGTH = 256
const TRUNCATION_SUFFIX = '...'

const DEFAULT_FEEDBACK_DESCRIPTION =
  'Send feedback about this server to its developers. Most important: report a missing capability whenever no ' +
  'available tool fits your task, even if you can work around it (feedback_type "missing_capability"). Also ' +
  'welcome: a tool that failed or confused you, an unhelpful error, or something that worked well. This records ' +
  'the feedback; it does not add or change tools. Do not include user PII or sensitive content.'

const CORE_FEEDBACK_SCHEMA_PROPERTIES = {
  feedback_type: {
    type: 'string',
    enum: [...FEEDBACK_TYPES],
    description:
      "What kind of feedback this is. Use 'missing_capability' when the tool you needed does not exist in the " +
      'tool list - nothing failed, the capability is absent (this is the most valuable report; send it even if ' +
      "you found a workaround). Use 'issue' when an existing tool behaved badly: it failed, returned a confusing " +
      "error, or its description or schema misled you. Use 'praise' when something worked notably well. Use " +
      "'other' for anything else.",
  },
  summary: {
    type: 'string',
    description:
      "One self-contained sentence. For 'missing_capability': the capability you needed, e.g. 'No tool to " +
      "delete multiple cohorts in one call.' For 'issue': the tool and the problem, e.g. 'query-trends rejects " +
      "relative date ranges with an unclear error.'",
  },
  details: {
    type: 'string',
    description:
      'Optional longer context: what you tried, exact parameter values, the error text you saw, and any ' +
      'workaround you used. Omit when the summary says it all.',
  },
  friction_points: {
    type: 'string',
    description:
      'Optional: the specific moments that slowed you down, as short bullet-like sentences, quoting exact tool ' +
      'names, parameters, or error text.',
  },
  suggested_improvement: {
    type: 'string',
    description:
      'Optional: the concrete change that would have helped, e.g. the tool to add, the description to reword, ' +
      'or the error message to improve.',
  },
  tool_name: {
    type: 'string',
    description:
      "Optional: the existing tool this feedback is about (for 'issue' or 'praise'). Leave empty for " +
      "'missing_capability' - the point is that no tool fits.",
  },
  sentiment: {
    type: 'string',
    enum: [...SENTIMENTS],
    description: 'Optional: how the experience felt overall.',
  },
  task_completed: {
    type: 'boolean',
    description: "Optional: whether you still completed the user's task despite the problem.",
  },
} as const

/**
 * Extra-property names a host may not declare: the core fields themselves, the
 * names whose `$mcp_feedback_<key>` property would collide with a core property
 * (`type` → `$mcp_feedback_type`, `tool` → `$mcp_feedback_tool`), and the
 * SDK-injected analytics arguments — the report is parsed from the raw
 * arguments before those are stripped, so an extra by the same name would
 * capture an SDK-owned value.
 */
const RESERVED_EXTRA_PROPERTY_KEYS = new Set([
  ...Object.keys(CORE_FEEDBACK_SCHEMA_PROPERTIES),
  'type',
  'tool',
  'context',
  'conversation_id',
  'llm_model',
])

type FeedbackToolDescriptor = CompatibleToolsListLike['tools'][number]

/** `collectFeedback` normalized to its object form; `undefined` when the feature is off. */
export function resolveCollectFeedbackOptions(
  config: CollectFeedbackConfig | undefined
): CollectFeedbackOptions | undefined {
  if (!config) {
    return undefined
  }
  return config === true ? {} : config
}

/**
 * The advertised descriptor: the core feedback schema plus the host's declared
 * `extraProperties`. Throws on a config error (a reserved extra key, or an
 * `extraRequired` entry that was never declared) so a bad setup fails at
 * configuration time instead of silently corrupting the advertised schema.
 */
export function getFeedbackToolDescriptor(options: CollectFeedbackOptions = {}): FeedbackToolDescriptor {
  const extraProperties = options.extraProperties ?? {}
  const extraRequired = options.extraRequired ?? []

  for (const key of Object.keys(extraProperties)) {
    if (RESERVED_EXTRA_PROPERTY_KEYS.has(key)) {
      throw new Error(
        `collectFeedback.extraProperties key "${key}" collides with a core or SDK-reserved send_feedback field. Rename it.`
      )
    }
  }
  for (const key of extraRequired) {
    if (!Object.prototype.hasOwnProperty.call(extraProperties, key)) {
      throw new Error(`collectFeedback.extraRequired key "${key}" is not declared in extraProperties.`)
    }
  }

  // Deep copy: the host may reuse or mutate the fragments it handed us.
  const copiedExtras =
    Object.keys(extraProperties).length > 0
      ? (JSON.parse(JSON.stringify(extraProperties)) as Record<string, unknown>)
      : undefined

  return {
    name: options.toolName ?? SEND_FEEDBACK_TOOL_NAME,
    description: options.description ?? DEFAULT_FEEDBACK_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        ...(JSON.parse(JSON.stringify(CORE_FEEDBACK_SCHEMA_PROPERTIES)) as Record<string, unknown>),
        ...copiedExtras,
      },
      required: ['feedback_type', 'summary', ...extraRequired],
    },
    annotations: {
      title: 'Send feedback',
      readOnlyHint: true,
      // Interacts with an external entity: the report lands in analytics.
      openWorldHint: true,
      // Only records the feedback, so repeat calls are harmless — and advertising
      // it as idempotent makes agents more willing to call it proactively.
      idempotentHint: true,
      destructiveHint: false,
    },
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function parseFeedbackType(value: unknown): FeedbackType {
  return FEEDBACK_TYPES.includes(value as FeedbackType) ? (value as FeedbackType) : 'other'
}

function parseSentiment(value: unknown): FeedbackSentiment | undefined {
  return SENTIMENTS.includes(value as FeedbackSentiment) ? (value as FeedbackSentiment) : undefined
}

/**
 * True when the value conforms to the declared fragment's `type` and `enum` —
 * the same advisory-schema enforcement the core fields get, so `extras` only
 * ever holds schema-conforming values and a misbehaving agent shows up as
 * absence rather than as an unexpected shape in the host's handler.
 */
function matchesExtraSchema(value: unknown, schema: FeedbackExtraPropertySchema): boolean {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (schema.type !== type && !(schema.type === 'integer' && typeof value === 'number')) {
    return false
  }
  return !Array.isArray(schema.enum) || schema.enum.includes(value as string)
}

/**
 * Parses the raw `send_feedback` arguments into a typed report. Never throws:
 * an invalid `feedback_type` falls back to `other`, missing fields stay
 * undefined, and only **declared** extras whose values match their declared
 * `type`/`enum` are lifted into `extras` — mismatches and anything the agent
 * invented reach the handler via `raw` only and are never captured.
 */
export function parseFeedbackReport(
  args: Record<string, unknown> | undefined,
  options: CollectFeedbackOptions = {}
): FeedbackReport {
  const raw = args ?? {}
  const extras: JsonRecord = {}
  for (const [key, schema] of Object.entries(options.extraProperties ?? {})) {
    if (raw[key] !== undefined && matchesExtraSchema(raw[key], schema)) {
      extras[key] = raw[key]
    }
  }
  return {
    feedbackType: parseFeedbackType(raw.feedback_type),
    summary: readString(raw.summary) ?? '',
    sentiment: parseSentiment(raw.sentiment),
    frictionPoints: readString(raw.friction_points),
    suggestedImprovement: readString(raw.suggested_improvement),
    details: readString(raw.details),
    toolName: readString(raw.tool_name),
    taskCompleted: typeof raw.task_completed === 'boolean' ? raw.task_completed : undefined,
    extras,
    raw,
  }
}

/** The report's free text, used as the event's `$mcp_intent`. */
export function buildFeedbackIntent(report: FeedbackReport): string {
  return [report.summary, report.details].filter(Boolean).join('\n\n')
}

function truncateFeedbackText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) + TRUNCATION_SUFFIX : value
}

/**
 * Agent-narrated free text can contain a secret the LLM read aloud or personal
 * data it narrated, so it gets exactly the `$mcp_intent` pass (`sanitizeIntent`:
 * credentials → structured PII → URLs — the order is load-bearing, the URL
 * rewrite would percent-encode the `@` the email pattern anchors on), then a
 * length bound. The event-level pipeline does not process `event.properties`,
 * so this happens here.
 */
function captureFreeText(value: string): string {
  return truncateFeedbackText(sanitizeIntent(value), MAX_FEEDBACK_TEXT_LENGTH)
}

/**
 * A declared extra is agent-supplied like the core free-text fields, so its
 * string leaves get the same intent-grade pass (with the key-based redaction
 * `sanitizeIntentValue` keeps for nested objects), then non-scalars are
 * JSON-stringified and everything is bounded.
 */
function captureExtraValue(value: unknown): unknown {
  const sanitized = sanitizeIntentValue(value)
  if (typeof sanitized === 'string') {
    return truncateFeedbackText(sanitized, MAX_FEEDBACK_TEXT_LENGTH)
  }
  if (sanitized == null || typeof sanitized === 'number' || typeof sanitized === 'boolean') {
    return sanitized
  }
  try {
    return truncateFeedbackText(JSON.stringify(sanitized), MAX_FEEDBACK_TEXT_LENGTH)
  } catch {
    return undefined
  }
}

/** The `$mcp_feedback_*` event properties for one report, declared extras included. */
export function buildFeedbackEventProperties(report: FeedbackReport): JsonRecord {
  const properties: JsonRecord = {
    [PostHogMCPAnalyticsProperty.FeedbackType]: report.feedbackType,
  }
  if (report.summary) {
    properties[PostHogMCPAnalyticsProperty.FeedbackSummary] = captureFreeText(report.summary)
  }
  if (report.sentiment) {
    properties[PostHogMCPAnalyticsProperty.FeedbackSentiment] = report.sentiment
  }
  if (report.frictionPoints) {
    properties[PostHogMCPAnalyticsProperty.FeedbackFrictionPoints] = captureFreeText(report.frictionPoints)
  }
  if (report.suggestedImprovement) {
    properties[PostHogMCPAnalyticsProperty.FeedbackSuggestedImprovement] = captureFreeText(report.suggestedImprovement)
  }
  if (report.details) {
    properties[PostHogMCPAnalyticsProperty.FeedbackDetails] = captureFreeText(report.details)
  }
  if (report.toolName) {
    // Nominally an identifier, but the schema can't stop an agent from writing
    // prose into it — so it gets the same intent-grade pass as the other free text.
    properties[PostHogMCPAnalyticsProperty.FeedbackTool] = truncateFeedbackText(
      sanitizeIntent(report.toolName),
      MAX_FEEDBACK_TOOL_NAME_LENGTH
    )
  }
  if (report.taskCompleted !== undefined) {
    properties[PostHogMCPAnalyticsProperty.FeedbackTaskCompleted] = report.taskCompleted
  }
  for (const [key, value] of Object.entries(report.extras)) {
    const captured = captureExtraValue(value)
    if (captured !== undefined) {
      properties[`$mcp_feedback_${key}`] = captured
    }
  }
  return properties
}

/**
 * The default acknowledgement returned to the agent after it calls
 * `send_feedback`. Reply with this from your dispatcher (custom dispatcher
 * path); the `instrument()` path returns it automatically, or the string your
 * `onFeedback` handler returned instead.
 */
export function sendFeedbackResult(): CompatibleTextToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: "Your feedback was recorded for the server's developers. No additional tools are available - continue with the tools already listed.",
      },
    ],
  }
}

/**
 * Runs the host's `onFeedback` handler (when configured) and builds the reply.
 * A returned non-blank string replaces the default acknowledgement; a thrown
 * handler is logged and falls back to it — feedback capture must never break
 * the agent's turn.
 */
export async function handleFeedback(
  report: FeedbackReport,
  options: CollectFeedbackOptions = {},
  logger: LoggerFn = log
): Promise<CompatibleTextToolResult> {
  // Only the type: the summary is agent-narrated free text (possible PII,
  // newlines for log forging, unbounded length) and does not belong in host logs.
  logger(`Agent feedback reported (${report.feedbackType})`)
  if (options.onFeedback) {
    try {
      const reply = await options.onFeedback(report)
      if (typeof reply === 'string' && reply.trim()) {
        return { content: [{ type: 'text' as const, text: reply }] }
      }
    } catch (error) {
      logger(`Warning: onFeedback handler threw; returning the default acknowledgement - ${error}`)
    }
  }
  return sendFeedbackResult()
}
