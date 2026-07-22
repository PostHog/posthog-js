// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

/**
 * MCP SDK Compatibility Helpers
 *
 * Internal utilities for handling differences between MCP SDK versions.
 * These helpers abstract away SDK-internal details like:
 * - Tool callback/handler property names (changed in SDK 1.24)
 * - Zod schema internal structures (v3 vs v4)
 */

import type { RegisteredTool, ToolCallback } from '../types'

// --- Tool function property utilities for MCP SDK version compatibility ---
// MCP SDK 1.23 and earlier use "callback", 1.24+ uses "handler"

export type ToolFunctionKey = 'callback' | 'handler'

/**
 * Returns the tool function (callback/handler) from a RegisteredTool.
 * Supports both MCP SDK 1.23- (callback) and 1.24+ (handler).
 */
export function getToolFunction(tool: RegisteredTool): ToolCallback {
  if ('handler' in tool && typeof tool.handler === 'function') {
    return tool.handler
  }
  if ('callback' in tool && typeof tool.callback === 'function') {
    return tool.callback
  }
  throw new Error('Tool has neither callback nor handler property')
}

/**
 * Returns the property key name used for the tool function ("callback" or "handler").
 * This preserves the original property name when wrapping tools.
 */
export function getToolFunctionKey(tool: RegisteredTool): ToolFunctionKey {
  if ('handler' in tool && typeof tool.handler === 'function') {
    return 'handler'
  }
  return 'callback'
}

/**
 * Returns true if the tool has a callback or handler property.
 */
export function hasToolFunction(tool: unknown): tool is RegisteredTool {
  if (!tool || typeof tool !== 'object') {
    return false
  }
  const t = tool as Record<string, unknown>
  return ('handler' in t && typeof t.handler === 'function') || ('callback' in t && typeof t.callback === 'function')
}

/**
 * Creates a new tool object with the wrapped function, preserving the original property name.
 * This ensures MCP SDK 1.24+ gets back a tool with "handler" and 1.23- gets "callback".
 */
export function createWrappedTool(originalTool: RegisteredTool, wrappedFunction: ToolCallback): RegisteredTool {
  const key = getToolFunctionKey(originalTool)
  return {
    ...originalTool,
    [key]: wrappedFunction,
  }
}

// --- Zod schema internal property helpers ---
// These access internal properties to extract method names from MCP SDK schemas
// No Zod import needed - we introspect the internal structure directly

interface ZodV3Internal {
  _def?: {
    value?: unknown
    values?: unknown[] // For enums - some Zod versions store literal values here
    shape?: Record<string, unknown> | (() => Record<string, unknown>)
  }
  shape?: Record<string, unknown> | (() => Record<string, unknown>)
}

interface ZodV4Internal {
  _zod?: {
    def?: {
      value?: unknown
      values?: unknown[] // For enums - some Zod versions store literal values here
      shape?: Record<string, unknown> | (() => Record<string, unknown>)
    }
  }
}

export function isZ4Schema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') {
    return false
  }
  return !!(schema as ZodV4Internal)._zod
}

export function getObjectShape(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') {
    return
  }

  let rawShape: Record<string, unknown> | (() => Record<string, unknown>) | undefined

  if (isZ4Schema(schema)) {
    const v4Schema = schema as ZodV4Internal
    rawShape = v4Schema._zod?.def?.shape
  } else {
    const v3Schema = schema as ZodV3Internal
    // Try .shape first, then fall back to _def.shape (some v3 schema types store it there)
    rawShape = v3Schema.shape ?? v3Schema._def?.shape
  }

  if (!rawShape) {
    return
  }

  if (typeof rawShape === 'function') {
    try {
      return rawShape()
    } catch {
      return
    }
  }

  return rawShape
}

export function getLiteralValue(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') {
    return
  }

  if (isZ4Schema(schema)) {
    const v4Schema = schema as ZodV4Internal
    const def = v4Schema._zod?.def
    if (def?.value !== undefined) {
      return def.value
    }
    // Fallback: values array (for enums)
    if (Array.isArray(def?.values) && def.values.length > 0) {
      return def.values[0]
    }
  } else {
    const v3Schema = schema as ZodV3Internal
    const def = v3Schema._def
    if (def?.value !== undefined) {
      return def.value
    }
    // Fallback: values array (for enums)
    if (Array.isArray(def?.values) && def.values.length > 0) {
      return def.values[0]
    }
  }

  // Final fallback: direct .value property (some Zod versions)
  const directValue = (schema as { value?: unknown }).value
  if (directValue !== undefined) {
    return directValue
  }

  return
}
