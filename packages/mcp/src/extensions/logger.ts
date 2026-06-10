// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

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

export function log(message: string): void {
  if (activeLogger) {
    try {
      activeLogger(message)
    } catch {
      // never let logging blow up the tracking pipeline
    }
  }
}