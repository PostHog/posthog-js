// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import type { HighLevelMCPServerLike, MCPServerLike } from '../types'
import { log } from './logger'

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

// Function to log compatibility information
export function logCompatibilityWarning(): void {
  log(
    'PostHog MCP analytics SDK Compatibility: This version only supports Model Context Protocol TypeScript SDK v1.11 and above. Please upgrade if using an older version.'
  )
}

// Check if server has high-level structure (wrapper with .server property)
export function isHighLevelServer(server: unknown): server is ServerRecord & { server: ServerRecord } {
  return (
    !!server && typeof server === 'object' && 'server' in server && !!server.server && typeof server.server === 'object'
  )
}

// Check if server has low-level structure (no .server property)
export function isLowLevelServer(server: unknown): server is ServerRecord {
  return !!server && typeof server === 'object' && !('server' in server)
}

// Type guard function that validates server compatibility and returns typed server
export function isCompatibleServerType(server: unknown): MCPServerLike | HighLevelMCPServerLike {
  if (!server || typeof server !== 'object') {
    logCompatibilityWarning()
    throw new Error(
      "PostHog MCP analytics SDK compatibility error: Server must be an object. Ensure you're using MCP SDK v1.11 or higher."
    )
  }

  if (isHighLevelServer(server)) {
    // Validate high-level server requirements
    if (!server._registeredTools || typeof server._registeredTools !== 'object') {
      logCompatibilityWarning()
      throw new Error(
        'PostHog MCP analytics SDK compatibility error: High-level server must have _registeredTools object. This requires MCP SDK v1.11 or higher.'
      )
    }
    if (typeof server.tool !== 'function') {
      logCompatibilityWarning()
      throw new Error(
        'PostHog MCP analytics SDK compatibility error: High-level server must have tool() method. This requires MCP SDK v1.11 or higher.'
      )
    }

    // Validate the underlying low-level server
    const targetServer = server.server
    validateLowLevelServer(targetServer)

    return server as unknown as HighLevelMCPServerLike
  }
  // Direct low-level server validation
  validateLowLevelServer(server)
  return server as MCPServerLike
}

// Helper function to validate low-level server requirements
function validateLowLevelServer(server: unknown): void {
  if (!server || typeof server !== 'object') {
    logCompatibilityWarning()
    throw new Error(
      "PostHog MCP analytics SDK compatibility error: Server must be an object. Ensure you're using MCP SDK v1.11 or higher."
    )
  }

  const serverRecord = server as ServerRecord

  if (typeof serverRecord.setRequestHandler !== 'function') {
    logCompatibilityWarning()
    throw new Error(
      'PostHog MCP analytics SDK compatibility error: Server must have a setRequestHandler method. This requires MCP SDK v1.11 or higher.'
    )
  }

  if (!(serverRecord._requestHandlers && serverRecord._requestHandlers instanceof Map)) {
    logCompatibilityWarning()
    throw new Error(
      'PostHog MCP analytics SDK compatibility error: Server._requestHandlers is not accessible. This requires MCP SDK v1.11 or higher.'
    )
  }

  // Validate that _requestHandlers contains functions with compatible signatures
  if (typeof serverRecord._requestHandlers.get !== 'function') {
    logCompatibilityWarning()
    throw new Error(
      'PostHog MCP analytics SDK compatibility error: Server._requestHandlers must be a Map with a get method. This requires MCP SDK v1.11 or higher.'
    )
  }

  if (typeof serverRecord.getClientVersion !== 'function') {
    logCompatibilityWarning()
    throw new Error(
      'PostHog MCP analytics SDK compatibility error: Server.getClientVersion must be a function. This requires MCP SDK v1.11 or higher.'
    )
  }

  if (
    !serverRecord._serverInfo ||
    typeof serverRecord._serverInfo !== 'object' ||
    !('name' in serverRecord._serverInfo)
  ) {
    logCompatibilityWarning()
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