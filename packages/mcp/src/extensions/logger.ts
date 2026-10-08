// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

/**
 * STDIO-safe logger.
 *
 * MCP servers running over the STDIO transport use stdout/stderr to exchange
 * protocol messages, so we cannot use the default `console.log`. We accept a
 * `logger` option on the public API or the legacy logger configured through
 * `setLogger`; when neither is configured, log calls are silently dropped.
 * Errors that affect tracking should still be observable in apps that want
 * them, so the consumer can plug in any function (e.g. `console.error` for
 * non-STDIO transports, a file logger, etc.).
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
 * Creates a safe logger for one instrumented server. A server-specific logger
 * remains isolated, while an omitted logger preserves the legacy `setLogger`
 * fallback.
 */
export function createLogger(logger: LoggerFn | undefined): LoggerFn {
  return logger ? (message) => writeLog(logger, message) : log
}

/** Logs through the legacy module-level logger configured by {@link setLogger}. */
export function log(message: string): void {
  writeLog(activeLogger, message)
}
