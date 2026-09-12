import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'
import type { PostHog } from 'posthog-node'
import { isFullAiCaptureEnabled } from '../captureAiEvent'
import { sanitizeAnthropic } from '../sanitization'
import { toContentString } from '../utils'
import type { FormattedContent, FormattedContentItem } from '../types'

/**
 * Tool results in an agent run carry whole files and command output, and the
 * same result is replayed as input on every later turn, so each string is
 * capped before it reaches the event.
 */
const TOOL_RESULT_MAX_STRING_LENGTH = 5000

/** Thinking blocks, recorded with the `reasoning` shape the other adapters use. */
interface FormattedReasoningContent {
  type: 'reasoning'
  text: string
}

export type ClaudeAgentContentItem = FormattedContentItem | FormattedReasoningContent

/** A tool result block queued as input for the next generation. */
interface FormattedToolResult {
  type: 'tool_result'
  tool_use_id: string
  content: unknown
  is_error?: boolean
}

function capStrings(value: unknown, max: number): unknown {
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}... [truncated]` : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => capStrings(item, max))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, capStrings(item, max)]))
  }
  return value
}

/** Redact binary content from a tool result and cap its strings. */
export function formatToolResultContent(content: unknown, client: PostHog): unknown {
  const redacted = sanitizeAnthropic(content, client)
  return isFullAiCaptureEnabled(client) ? redacted : capStrings(redacted, TOOL_RESULT_MAX_STRING_LENGTH)
}

/** Read the system prompt out of the SDK options, whatever shape it takes. */
export function extractSystemPrompt(options: Options | undefined): string | undefined {
  const systemPrompt = options?.systemPrompt
  if (typeof systemPrompt === 'string') {
    return systemPrompt
  }
  if (Array.isArray(systemPrompt)) {
    return systemPrompt.filter((part) => part !== SYSTEM_PROMPT_DYNAMIC_BOUNDARY).join('')
  }
  return systemPrompt?.append
}

/** Convert Anthropic assistant content blocks into PostHog content items. */
export function formatAssistantBlocks(blocks: unknown, client: PostHog): ClaudeAgentContentItem[] {
  if (!Array.isArray(blocks)) {
    return []
  }

  const content: ClaudeAgentContentItem[] = []
  for (const block of blocks as Array<Record<string, any>>) {
    if (block == null) {
      continue
    }
    if (typeof block.thinking === 'string') {
      content.push({ type: 'reasoning', text: block.thinking })
    } else if (block.type === 'tool_use') {
      content.push({
        type: 'function',
        id: block.id,
        function: {
          name: block.name,
          arguments: block.input ?? {},
        },
      })
    } else if (typeof block.text === 'string') {
      content.push({ type: 'text', text: block.text })
    } else {
      content.push({ type: 'text', text: toContentString(sanitizeAnthropic(block, client)) })
    }
  }
  return content
}

/** Convert an Anthropic user message body into PostHog content items. */
export function formatUserContent(content: unknown, client: PostHog): FormattedContent | unknown {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return []
  }

  const formatted: Array<ClaudeAgentContentItem | FormattedToolResult> = []
  for (const block of content as Array<Record<string, any>>) {
    if (block == null) {
      continue
    }
    if (block.type === 'tool_result') {
      formatted.push({
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: formatToolResultContent(block.content, client),
        ...(typeof block.is_error === 'boolean' ? { is_error: block.is_error } : {}),
      })
    } else if (typeof block.text === 'string') {
      formatted.push({ type: 'text', text: block.text })
    }
  }
  return formatted
}
