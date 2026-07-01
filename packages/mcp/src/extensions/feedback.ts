import { type CallToolResult, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js'

import type { JsonRecord } from '../types'
import { PostHogMCPAnalyticsProperty } from './constants'
import { log } from './logger'

export const SUBMIT_FEEDBACK_NAME = 'submit_feedback' as const

/**
 * The configured name of the `submit_feedback` virtual tool, falling back to the
 * default. Resolve through here everywhere (inject + detect) so a custom name
 * can't drift between call sites — mirrors `resolveMissingCapabilityToolName`.
 */
export function resolveFeedbackToolName(options?: { feedbackToolName?: string }): string {
  return options?.feedbackToolName ?? SUBMIT_FEEDBACK_NAME
}

type FeedbackToolDescriptor = ListToolsResult['tools'][number]

/**
 * The `submit_feedback` virtual tool. Like `get_more_tools`, it is advertised in
 * `tools/list` but never dispatched to a real handler — the `instrument()` path
 * intercepts the call, captures a `$mcp_feedback` event, and replies with
 * {@link getFeedbackResult}. The schema mirrors PostHog's own `agent-feedback`
 * tool so the two produce comparable analytics.
 */
export function getSubmitFeedbackDescriptor(name: string = SUBMIT_FEEDBACK_NAME): FeedbackToolDescriptor {
  return {
    name,
    description:
      'Share structured feedback about this MCP server or the product it exposes — a rough edge, an unclear tool, a missing capability, a bug, or something that worked well. Praise and feature requests are useful too, not just problems. Call it whenever you or the user hit something worth telling the team; it records the feedback and does not end your turn.',
    inputSchema: {
      type: 'object',
      properties: {
        feedback_type: {
          type: 'string',
          enum: ['product', 'mcp', 'docs', 'other'],
          description:
            'What the feedback is about: "product" for a feature exposed by this server, "mcp" for the MCP server itself (tool descriptions, schemas, responses, errors), "docs" for documentation, or "other".',
        },
        sentiment: {
          type: 'string',
          enum: ['positive', 'neutral', 'negative', 'mixed'],
          description: 'The overall sentiment of the feedback.',
        },
        summary: {
          type: 'string',
          description: 'A single-sentence summary of the feedback.',
        },
        category: {
          type: 'string',
          description:
            'For `feedback_type: "mcp"`: the dominant theme — e.g. missing_tool, tool_description, tool_input_schema, tool_output_format, instructions_clarity, tool_correctness, error_message, or performance. Omit for other types.',
        },
        product_area: {
          type: 'string',
          description: 'The product or area this is about, in free text (e.g. "session replay", "feature flags").',
        },
        friction_points: {
          type: 'string',
          description: 'What slowed the task down or went wrong, quoting exact tool names, parameters, or error text.',
        },
        suggested_improvement: {
          type: 'string',
          description: 'A concrete suggestion for how to improve it. Most valuable for negative or mixed feedback.',
        },
        task_completed: {
          type: 'boolean',
          description: "Whether you were able to finish the user's request. Set false when you could not.",
        },
        details: {
          type: 'string',
          description: 'Any additional detail that does not fit the other fields.',
        },
      },
      required: ['feedback_type', 'sentiment', 'summary'],
    },
    annotations: {
      title: 'Submit Feedback',
      // Recording feedback doesn't mutate state on the MCP server.
      readOnlyHint: true,
      // Interacts with external entities because we store this in analytics.
      openWorldHint: true,
      // Each call records a distinct `$mcp_feedback` event, so it is NOT idempotent —
      // a client that retried a timed-out call on this hint would duplicate the event.
      // `readOnlyHint` already signals it's safe to call proactively.
      idempotentHint: false,
      // Never deletes any data from the MCP server.
      destructiveHint: false,
    },
  }
}

/**
 * The canned acknowledgement returned to the agent after it calls
 * `submit_feedback`. Reply with this from your dispatcher so the agent knows the
 * feedback was recorded (custom dispatcher path); the `instrument()` path returns
 * it automatically.
 */
export function getFeedbackResult(): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text:
          'Thank you for the feedback — it has been recorded and will be reviewed by the team. Submitting feedback ' +
          "does not mean your work is done: keep going and finish the user's task using the other available tools.",
      },
    ],
  }
}

export function handleSubmitFeedback(args: JsonRecord): CallToolResult {
  log(`Feedback submitted: ${JSON.stringify(args)}`)
  return getFeedbackResult()
}

/** The `submit_feedback` argument keys, mapped to their `$mcp_`-prefixed event property. */
const FEEDBACK_PROPERTY_BY_ARG = {
  feedback_type: PostHogMCPAnalyticsProperty.FeedbackType,
  sentiment: PostHogMCPAnalyticsProperty.FeedbackSentiment,
  category: PostHogMCPAnalyticsProperty.FeedbackCategory,
  summary: PostHogMCPAnalyticsProperty.FeedbackSummary,
  details: PostHogMCPAnalyticsProperty.FeedbackDetails,
  product_area: PostHogMCPAnalyticsProperty.FeedbackProductArea,
  suggested_improvement: PostHogMCPAnalyticsProperty.FeedbackSuggestedImprovement,
  friction_points: PostHogMCPAnalyticsProperty.FeedbackFrictionPoints,
  task_completed: PostHogMCPAnalyticsProperty.FeedbackTaskCompleted,
} as const

/**
 * Maps the raw `submit_feedback` arguments onto the `$mcp_`-prefixed event
 * properties carried by `$mcp_feedback`. Unknown keys are dropped and
 * `null`/`undefined` values are skipped so the event only carries what the agent
 * actually supplied. Shared by the `instrument()` and `PostHogMCP` paths so both
 * emit the same shape.
 */
export function buildFeedbackEventProperties(args: JsonRecord | undefined): JsonRecord {
  const properties: JsonRecord = {}
  if (!args) {
    return properties
  }
  for (const [arg, property] of Object.entries(FEEDBACK_PROPERTY_BY_ARG)) {
    const value = args[arg]
    if (value !== undefined && value !== null) {
      properties[property] = value
    }
  }
  return properties
}
