import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'
import type { PostHog } from 'posthog-node'
import { MAX_OUTPUT_SIZE, toContentString, withPrivacyMode } from '../utils'
import { formatToolResult } from '../toolResult'
import type { FormattedContent, FormattedContentItem } from '../types'

/** Thinking blocks, recorded with the `reasoning` shape the other adapters use. */
interface FormattedReasoningContent {
  type: 'reasoning'
  text: string
}

export type ClaudeAgentContentItem = FormattedContentItem | FormattedReasoningContent

export function formatContent(content: unknown, client: PostHog, maxBytes = MAX_OUTPUT_SIZE): unknown {
  return formatToolResult(content, client, maxBytes)
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
  for (const block of formatContent(blocks, client) as Array<Record<string, any>>) {
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
      content.push({ type: 'text', text: toContentString(block) })
    }
  }
  return content
}

/** Convert an Anthropic user message body into PostHog content items. */
export function formatUserContent(content: unknown, client: PostHog, privacyMode = false): FormattedContent | unknown {
  if (withPrivacyMode(client, privacyMode, false) === null) return []
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return []
  }

  const formatted: unknown[] = []
  for (const block of content as Array<Record<string, any>>) {
    if (block == null) {
      continue
    }
    if (block.type === 'tool_result') {
      formatted.push({
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: formatToolResult(block.content, client),
        ...(typeof block.is_error === 'boolean' ? { is_error: block.is_error } : {}),
      })
    } else if (typeof block.text === 'string') {
      formatted.push({ type: 'text', text: block.text })
    } else {
      formatted.push(formatContent(block, client))
    }
  }
  return formatted
}
