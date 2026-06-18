import { newPrefixedId } from './ids'

/**
 * A CLI invocation is short-lived, so the session model is simple: one process =
 * one session. A fresh id is minted at startup and stamped on every event from
 * that run (the Vercel CLI model), correlating the events of a single command
 * without any long-lived/inactivity bookkeeping.
 */
export function newSessionId(): string {
    return newPrefixedId('ses')
}
