// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

/**
 * STDIO-safe logger.
 *
 * MCP servers running over the STDIO transport use stdout/stderr to exchange
 * protocol messages, so we cannot use the default `console.log`. We accept a
 * `logger` option on the public API; when omitted, log calls are silently
 * dropped. Errors that affect tracking should still be observable in apps that
 * want them, so the consumer can plug in any function (e.g. `console.error`
 * for non-STDIO transports, a file logger, etc.).
 */
export type LoggerFn = (message: string) => void

let activeLogger: LoggerFn | undefined

export function setLogger(logger: LoggerFn | undefined): void {
  activeLogger = logger
}

function writeLog(logger: LoggerFn | undefined, message: string): void {
  if (logger) {
    try {
      logger(message)
    } catch {
      // never let logging blow up the tracking pipeline
    }
  }
}

/**
 * Creates an isolated, safe logger for one instrumented server. In particular,
 * an omitted logger stays a no-op rather than falling back to `activeLogger`.
 */
export function createLogger(logger: LoggerFn | undefined): LoggerFn {
  return (message) => writeLog(logger, message)
}

/** Logs through the legacy module-level logger configured by {@link setLogger}. */
export function log(message: string): void {
  writeLog(activeLogger, message)
}
