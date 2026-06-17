/**
 * Minimal logging surface the client exposes to extensions. Warnings and errors
 * are always emitted; `info` and `debug` are expected to be gated behind the
 * client's debug setting (the extension does not decide that).
 */
export interface Logger {
    /** Emit an informational diagnostic message when the host client's debug policy allows it. */
    info(...args: unknown[]): void
    /** Emit a warning for recoverable extension issues or unexpected client state. */
    warn(...args: unknown[]): void
    /** Emit an error for failed extension work that could not be recovered locally. */
    error(...args: unknown[]): void
    /** Emit verbose diagnostics when the host client's debug policy allows it. */
    debug(...args: unknown[]): void
}
