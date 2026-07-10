// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type {
  CompatibleRequestHandlerExtra,
  MCPAnalyticsData,
  MCPAnalyticsIntentSource,
  MCPRequestLike,
  McpEvent,
} from '../types'
import { isContextEnabled } from './context-parameters'
import { log } from './logger'

interface ResolvedIntent {
  intent: string
  source: MCPAnalyticsIntentSource
}

function getContextArgument(request: MCPRequestLike): string | undefined {
  const context = request.params?.arguments?.context
  return typeof context === 'string' && context.trim() ? context : undefined
}

function normalizeIntent(intent: string | null | undefined): string | null {
  if (typeof intent !== 'string') {
    return null
  }

  const trimmed = intent.trim()
  return trimmed ? trimmed : null
}

async function runIntentFallback(
  data: MCPAnalyticsData,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<ResolvedIntent | null> {
  if (!data.options.intentFallback) {
    return null
  }

  try {
    const intent = normalizeIntent(await data.options.intentFallback(request, extra))
    return intent ? { intent, source: 'inferred' } : null
  } catch (error) {
    log(`intentFallback callback error: ${error}`)
    return null
  }
}

export async function resolveToolCallIntent(
  data: MCPAnalyticsData,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<ResolvedIntent | null> {
  const contextArgument = getContextArgument(request)
  if (isContextEnabled(data.options.context) && request.params?.name !== 'get_more_tools' && contextArgument) {
    return { intent: contextArgument, source: 'context_parameter' }
  }

  return await runIntentFallback(data, request, extra)
}

export function setEventIntent(event: McpEvent, resolvedIntent: ResolvedIntent | null): void {
  if (!resolvedIntent) {
    return
  }

  event.userIntent = resolvedIntent.intent
  event.userIntentSource = resolvedIntent.source
}

export function setExplicitContextIntent(event: McpEvent, context: string): void {
  const intent = normalizeIntent(context)
  if (!intent) {
    return
  }

  event.userIntent = intent
  event.userIntentSource = 'context_parameter'
}
