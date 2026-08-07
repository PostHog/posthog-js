// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { HighLevelMCPServerLike, MCPServerLike } from '../types'
import {
  canRegisterTools,
  canSetRequestHandler,
  hasClientVersionAccessor,
  hasNestedLowLevelServer,
  hasRequestHandlerMap,
  hasServerInfo,
  hasToolRegistry,
  isBareServerShape,
} from './detect'
import type { LoggerFn } from './logger'

type ServerRecord = Record<string, unknown>

/**
 * PostHog MCP analytics Compatibility Module
 *
 * This module ensures compatibility with Model Context Protocol TypeScript SDK.
 * PostHog MCP analytics only supports MCP SDK version 1.11 and above.
 *
 * Version 1.11+ is required because it introduced stable APIs for:
 * - Tool registration and handling
 * - Request handler access patterns
 * - Client version detection
 * - Server info structure
 */

export function logCompatibilityWarning(logger: LoggerFn): void {
  logger(
    'PostHog MCP analytics SDK Compatibility: This version only supports Model Context Protocol TypeScript SDK v1.11 and above. Please upgrade if using an older version.'
  )
}

export function isHighLevelServer(server: unknown): server is ServerRecord & { server: ServerRecord } {
  return hasNestedLowLevelServer(server)
}

export function isLowLevelServer(server: unknown): server is ServerRecord {
  return isBareServerShape(server)
}

export function isCompatibleServerType(server: unknown, logger: LoggerFn): MCPServerLike | HighLevelMCPServerLike {
  if (!server || typeof server !== 'object') {
    logCompatibilityWarning(logger)
    throw new Error(
      "PostHog MCP analytics SDK compatibility error: Server must be an object. Ensure you're using MCP SDK v1.11 or higher."
    )
  }

  if (isHighLevelServer(server)) {
    if (!hasToolRegistry(server)) {
      logCompatibilityWarning(logger)
      throw new Error(
        'PostHog MCP analytics SDK compatibility error: High-level server must have _registeredTools object. This requires MCP SDK v1.11 or higher.'
      )
    }
    // Either registration method is enough. v1 has both; v2 dropped the
    // deprecated tool() and kept registerTool(). Demanding tool() rejected every
    // v2 high-level server, and instrument() swallows the rejection — so the
    // integration looked healthy and captured nothing.
    if (!canRegisterTools(server)) {
      logCompatibilityWarning(logger)
      throw new Error(
        'PostHog MCP analytics SDK compatibility error: High-level server must have a registerTool() or tool() method. This requires MCP SDK v1.11 or higher.'
      )
    }

    const targetServer = server.server
    validateLowLevelServer(targetServer, logger)

    return server as unknown as HighLevelMCPServerLike
  }
  validateLowLevelServer(server, logger)
  return server as MCPServerLike
}

function validateLowLevelServer(server: unknown, logger: LoggerFn): void {
  if (!server || typeof server !== 'object') {
    logCompatibilityWarning(logger)
    throw new Error(
      "PostHog MCP analytics SDK compatibility error: Server must be an object. Ensure you're using MCP SDK v1.11 or higher."
    )
  }

  if (!canSetRequestHandler(server)) {
    logCompatibilityWarning(logger)
    throw new Error(
      'PostHog MCP analytics SDK compatibility error: Server must have a setRequestHandler method. This requires MCP SDK v1.11 or higher.'
    )
  }

  // A real Map with a working get(), which is what the handler patch reads and
  // writes. Both majors keep it.
  if (!hasRequestHandlerMap(server)) {
    logCompatibilityWarning(logger)
    throw new Error(
      'PostHog MCP analytics SDK compatibility error: Server._requestHandlers is not accessible. This requires MCP SDK v1.11 or higher.'
    )
  }

  if (!hasClientVersionAccessor(server)) {
    logCompatibilityWarning(logger)
    throw new Error(
      'PostHog MCP analytics SDK compatibility error: Server.getClientVersion must be a function. This requires MCP SDK v1.11 or higher.'
    )
  }

  if (!hasServerInfo(server)) {
    logCompatibilityWarning(logger)
    throw new Error(
      'PostHog MCP analytics SDK compatibility error: Server._serverInfo is not accessible or missing name. This requires MCP SDK v1.11 or higher.'
    )
  }
}

export function getMCPCompatibleErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    try {
      return JSON.stringify(error, Object.getOwnPropertyNames(error))
    } catch {
      return 'Unknown error'
    }
  } else if (typeof error === 'string') {
    return error
  } else if (typeof error === 'object' && error !== null) {
    return JSON.stringify(error)
  }
  return 'Unknown error'
}
