// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import type { ContextData } from '../context/types'

type PostHogListener = { _posthogErrorHandler: boolean }
type ErrorHandler = PostHogListener & NodeJS.UncaughtExceptionListener
type RejectionHandler = PostHogListener & NodeJS.UnhandledRejectionListener
type UnhandledRejectionMode = 'throw' | 'strict' | 'warn' | 'warn-with-error-code' | 'none'

const UNHANDLED_REJECTION_OPTION_NAMES = ['--unhandled-rejections', '--unhandled_rejections']
const UNHANDLED_REJECTION_MODES = new Set<UnhandledRejectionMode>([
  'throw',
  'strict',
  'warn',
  'warn-with-error-code',
  'none',
])
const STARTUP_EXEC_ARGV = [...(globalThis.process?.execArgv ?? [])]
const STARTUP_NODE_OPTIONS = globalThis.process?.env?.NODE_OPTIONS

function splitNodeOptions(nodeOptions: string): string[] {
  const args: string[] = []
  let current = ''
  let isInString = false

  for (let index = 0; index < nodeOptions.length; index++) {
    const character = nodeOptions[index]

    if (character === '\\' && isInString && index + 1 < nodeOptions.length) {
      current += nodeOptions[++index]
    } else if (character === ' ' && !isInString) {
      if (current) {
        args.push(current)
        current = ''
      }
    } else if (character === '"') {
      isInString = !isInString
    } else {
      current += character
    }
  }

  if (current) {
    args.push(current)
  }

  return args
}

function findUnhandledRejectionMode(args: string[]): UnhandledRejectionMode | undefined {
  let mode: UnhandledRejectionMode | undefined

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    const optionName = UNHANDLED_REJECTION_OPTION_NAMES.find(
      (name) => argument === name || argument.startsWith(`${name}=`)
    )
    if (!optionName) {
      continue
    }

    const value = argument === optionName ? args[++index] : argument.slice(optionName.length + 1)
    if (UNHANDLED_REJECTION_MODES.has(value as UnhandledRejectionMode)) {
      mode = value as UnhandledRejectionMode
    }
  }

  return mode
}

export function getUnhandledRejectionMode(
  execArgv: string[] = STARTUP_EXEC_ARGV,
  nodeOptions: string | undefined = STARTUP_NODE_OPTIONS
): UnhandledRejectionMode {
  // Command-line arguments take precedence over NODE_OPTIONS, and the last occurrence wins within each source.
  return (
    findUnhandledRejectionMode(execArgv) ?? findUnhandledRejectionMode(splitNodeOptions(nodeOptions ?? '')) ?? 'throw'
  )
}

const STARTUP_UNHANDLED_REJECTION_MODE = getUnhandledRejectionMode()

/** A client that captures exceptions through the shared process listeners. */
export type AutocaptureClient = {
  // Clients with the same project token and host send to the same project, so only one of them captures.
  key: string
  capture: (exception: unknown, hint: CoreErrorTracking.EventHint) => void
  // Each client keeps its own request context, set with withContext.
  getContext: () => ContextData | undefined
  // Sends what the client still holds. Called before a fatal exit.
  shutdown: () => Promise<void>
}

const UNHANDLED_REJECTION_HINT: CoreErrorTracking.EventHint = {
  mechanism: { type: 'onunhandledrejection', handled: false },
}
const UNCAUGHT_EXCEPTION_HINT: CoreErrorTracking.EventHint = {
  mechanism: { type: 'onuncaughtexception', handled: false },
}

// Next.js and React pass these through rejections and throws as control flow. @sentry/nextjs drops the same set.
const CONTROL_FLOW_DIGESTS = new Set([
  'HANGING_PROMISE_REJECTION',
  'NEXT_PRERENDER_INTERRUPTED',
  'DYNAMIC_SERVER_USAGE',
  'BAILOUT_TO_CLIENT_SIDE_RENDERING',
])
const REACT_POSTPONE = Symbol.for('react.postpone')
const NEXT_REJECTION_FILTER = Symbol.for('next.unhandledRejectionFilter')

// Next.js 16's patched process.on announces an unhandledRejection listener through this event instead.
const NEXT_LISTENER_EVENT = 'Next.UnhandledRejectionFilter.MacguffinEvent'

// Shared through globalThis, so that every client and every copy of this module in the process (bundlers can load
// posthog-node more than once, for example in Next.js's separate server layers) use one set of process listeners.
// Bump the version in this key whenever the shape of what it holds changes.
const STATE_KEY = Symbol.for('posthog-node.exception-autocapture.v1')

type CaptureSource = 'autocapture' | 'app'

// A capture waiting for the end of the current turn of the event loop.
type DeferredCapture = {
  exception: unknown
  hint: CoreErrorTracking.EventHint
  // The projects the app captured the exception for itself, which autocapture skips.
  skipKeys: Set<string>
}

type AutocaptureState = {
  mode: UnhandledRejectionMode
  clients: Set<AutocaptureClient>
  // The last client of each project that shut down. It keeps capturing until another client of the project starts,
  // as the listeners of a shut-down client always did, so that a client per request still captures between requests.
  retired: Map<string, AutocaptureClient>
  // Who captured each exception for each project during this turn: autocapture, or the app through captureException.
  // A host that rethrows a rejection, a runtime that reports one twice, and an app that captures an error and rethrows
  // it all hand over the same exception again before the turn ends. Primitives compare by value. The same error object
  // in a later turn is a new occurrence.
  capturedThisTurn: Map<unknown, Map<string, CaptureSource>>
  deferred: Set<DeferredCapture>
  turnResetScheduled: boolean
  calledFatalError: boolean
  removeListeners: () => void
}

type PostHogGlobal = typeof globalThis & {
  [STATE_KEY]?: AutocaptureState
  [NEXT_REJECTION_FILTER]?: boolean
}

const posthogGlobal = globalThis as PostHogGlobal

function isPostHogListener(listener: unknown): boolean {
  return typeof listener === 'function' && (listener as Partial<PostHogListener>)._posthogErrorHandler === true
}

function isWeakKey(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function markListener<T extends (...args: any[]) => unknown>(listener: T): T & PostHogListener {
  return Object.assign(listener, { _posthogErrorHandler: true })
}

function hasHostUnhandledRejectionListener(process: NodeJS.Process): boolean {
  return process.listeners('unhandledRejection').some((listener) => !isPostHogListener(listener))
}

function isFrameworkControlFlow(reason: unknown, depth = 0): boolean {
  try {
    if (!isWeakKey(reason)) {
      return false
    }
    const candidate = reason as { $$typeof?: unknown; digest?: unknown; cause?: unknown }
    if (candidate.$$typeof === REACT_POSTPONE) {
      return true
    }
    if (typeof candidate.digest === 'string' && CONTROL_FLOW_DIGESTS.has(candidate.digest)) {
      return true
    }
    return depth < 5 && isFrameworkControlFlow(candidate.cause, depth + 1)
  } catch {
    // A throwing getter or a revoked proxy is not a framework signal.
    return false
  }
}

// An abort the app started itself and never awaited, for example a cancelled fetch. Sentry ignores these too.
function isAbortError(reason: unknown): boolean {
  try {
    return isWeakKey(reason) && (reason as { name?: unknown }).name === 'AbortError'
  } catch {
    return false
  }
}

function isIgnored(exception: unknown, origin: NodeJS.UncaughtExceptionOrigin | 'unhandledRejection'): boolean {
  return isFrameworkControlFlow(exception) || (origin === 'unhandledRejection' && isAbortError(exception))
}

// One client per project: a running one if there is one, otherwise the last one that shut down. Among running
// clients, the one whose request context is active here, since no other client of the project can see it.
function captureTargets(state: AutocaptureState): AutocaptureClient[] {
  const targets = new Map<string, AutocaptureClient>()
  for (const client of state.clients) {
    const chosen = targets.get(client.key)
    if (!chosen || (chosen.getContext() === undefined && client.getContext() !== undefined)) {
      targets.set(client.key, client)
    }
  }
  for (const [key, client] of state.retired) {
    if (!targets.has(key)) {
      targets.set(key, client)
    }
  }
  return [...targets.values()]
}

function scheduleTurnReset(state: AutocaptureState): void {
  if (state.turnResetScheduled) {
    return
  }
  state.turnResetScheduled = true
  // The turn ends one immediate late, because a rethrow can come from an immediate: Next.js 16's filter rethrows a
  // listener's error with setImmediate.
  const reset = setImmediate(() => {
    const deferredReset = setImmediate(() => {
      state.capturedThisTurn.clear()
      state.turnResetScheduled = false
    })
    deferredReset.unref?.()
  })
  reset.unref?.()
}

function recordCapture(state: AutocaptureState, exception: unknown, key: string, source: CaptureSource): void {
  const captured = state.capturedThisTurn.get(exception) ?? new Map<string, CaptureSource>()
  if (!captured.has(key)) {
    captured.set(key, source)
  }
  state.capturedThisTurn.set(exception, captured)
  scheduleTurnReset(state)
}

function wasCapturedThisTurn(state: AutocaptureState, exception: unknown): boolean {
  const captured = state.capturedThisTurn.get(exception)
  return captured !== undefined && captureTargets(state).every((client) => captured.has(client.key))
}

// Sends the exception to every project that has not received it in this turn.
function dispatch(
  state: AutocaptureState,
  exception: unknown,
  hint: CoreErrorTracking.EventHint,
  skipKeys?: Set<string>
): void {
  const captured = state.capturedThisTurn.get(exception)
  for (const client of captureTargets(state)) {
    if (captured?.has(client.key) || skipKeys?.has(client.key)) {
      continue
    }
    recordCapture(state, exception, client.key, 'autocapture')
    client.capture(exception, hint)
  }
}

function findDeferred(state: AutocaptureState, exception: unknown): DeferredCapture | undefined {
  return [...state.deferred].find((deferred) => deferred.exception === exception)
}

function captureDeferred(state: AutocaptureState, deferred: DeferredCapture): void {
  if (state.deferred.delete(deferred)) {
    dispatch(state, deferred.exception, deferred.hint, deferred.skipKeys)
  }
}

// Used when the process survives the exception. The host's listeners run after ours, and a framework's error hook a
// microtask later, so capturing at the end of the turn lets the app's own capture win, with the identity and
// properties it passes. The immediate runs in this listener's async context, so it keeps the request context.
function deferCapture(state: AutocaptureState, exception: unknown, hint: CoreErrorTracking.EventHint): void {
  if (wasCapturedThisTurn(state, exception) || findDeferred(state, exception)) {
    return
  }
  const deferred: DeferredCapture = {
    exception,
    hint,
    skipKeys: new Set(state.capturedThisTurn.get(exception)?.keys()),
  }
  state.deferred.add(deferred)
  setImmediate(() => captureDeferred(state, deferred))
}

async function exitAfterFatalError(state: AutocaptureState, error: unknown): Promise<void> {
  console.error(error)
  // Captures waiting for the end of the turn would go down with the process.
  for (const deferred of [...state.deferred]) {
    captureDeferred(state, deferred)
  }
  const clients = new Set([...state.clients, ...state.retired.values()])
  await Promise.all([...clients].map((client) => client.shutdown().catch(() => undefined)))
  globalThis.process.exit(1)
}

function captureUncaughtException(
  state: AutocaptureState,
  error: unknown,
  origin: NodeJS.UncaughtExceptionOrigin,
  fatal: boolean
): void {
  if (isIgnored(error, origin)) {
    return
  }
  const hint = origin === 'unhandledRejection' ? UNHANDLED_REJECTION_HINT : UNCAUGHT_EXCEPTION_HINT
  if (!fatal) {
    // The app handles uncaught exceptions itself, and its listener may capture this one.
    deferCapture(state, error, hint)
    return
  }
  // A host listener that rethrew a rejection: one occurrence, reported as the rejection it was.
  const deferred = findDeferred(state, error)
  if (deferred) {
    captureDeferred(state, deferred)
  } else {
    dispatch(state, error, hint)
  }
}

function makeUncaughtExceptionHandler(state: AutocaptureState): ErrorHandler {
  return markListener((error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
    const process = globalThis.process
    // Like Sentry, we only consider listeners that are currently registered. We intentionally do not reconstruct
    // participation by once listeners or listeners added or removed during dispatch.
    const userProvidedListenersCount = process.listeners('uncaughtException').filter((listener) => {
      return listener.name !== 'domainUncaughtExceptionClear' && !isPostHogListener(listener)
    }).length
    const fatal = userProvidedListenersCount === 0

    captureUncaughtException(state, error, origin, fatal)

    if (fatal && !state.calledFatalError) {
      state.calledFatalError = true
      void exitAfterFatalError(state, error)
    }
  })
}

// The error Node raises in throw mode for a rejection whose reason is not an Error.
function toUnhandledRejectionError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason
  }
  const error = new Error(
    `This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason "${String(reason)}".`
  )
  return Object.assign(error, { name: 'UnhandledPromiseRejection', code: 'ERR_UNHANDLED_REJECTION' })
}

// No host listener is left, but ours still runs: the host's listener went away without a removeListener event (Bun
// never emits one), or the runtime does not escalate rejections at all (Bun again). Our listener has stopped the
// runtime's default handling, so do what the runtime would have done without it.
function applyDefaultRejectionHandling(state: AutocaptureState, reason: unknown): void {
  const process = globalThis.process
  if (state.mode === 'warn-with-error-code') {
    process.emitWarning(`Unhandled promise rejection: ${String(reason)}`, 'UnhandledPromiseRejectionWarning')
    process.exitCode = 1
    if (!isIgnored(reason, 'unhandledRejection')) {
      dispatch(state, reason, UNHANDLED_REJECTION_HINT)
    }
    return
  }

  if (process.versions?.bun) {
    // Bun exits on an unhandled rejection without emitting uncaughtException.
    if (!isIgnored(reason, 'unhandledRejection')) {
      dispatch(state, reason, UNHANDLED_REJECTION_HINT)
    }
    if (!state.calledFatalError) {
      state.calledFatalError = true
      void exitAfterFatalError(state, reason)
    }
    return
  }

  // Node escalates the rejection to the uncaught-exception listeners, with the origin 'unhandledRejection'. Ours is one
  // of them: it captures the rejection, and exits unless the app handles uncaught exceptions itself.
  const escalated = toUnhandledRejectionError(reason)
  const emit = process.emit as (event: string, ...args: unknown[]) => boolean
  emit.call(process, 'uncaughtExceptionMonitor', escalated, 'unhandledRejection')
  emit.call(process, 'uncaughtException', escalated, 'unhandledRejection')
}

// replacesDefaultHandling: in throw and warn-with-error-code modes, an unhandledRejection listener replaces the
// runtime's default handling, so ours must reproduce it when it is the only one left.
function makeUnhandledRejectionHandler(
  state: AutocaptureState,
  replacesDefaultHandling: boolean,
  isInstalled: () => boolean
): RejectionHandler {
  return markListener((reason: unknown): void => {
    // Our listener runs first, so a host listener that is gone now was not there when the rejection was emitted, unless
    // ours went with it: a once listener, or one that removes itself, takes ours along through the removeListener
    // handler, and the emit still calls ours from its copy of the list.
    if (replacesDefaultHandling && !hasHostUnhandledRejectionListener(globalThis.process) && isInstalled()) {
      applyDefaultRejectionHandling(state, reason)
      return
    }
    if (!isIgnored(reason, 'unhandledRejection')) {
      deferCapture(state, reason, UNHANDLED_REJECTION_HINT)
    }
  })
}

// Next.js 16 moves every unhandledRejection listener into a queue behind one filtering listener, and patches
// process.on and process.listeners so that later listeners join that queue too. The filter drops rejections from
// prerenders Next has aborted on purpose. A listener left on the process in front of the filter would capture those,
// and one in both places would capture everything twice, so move ours into the queue once the filter is in place.
function joinHostRejectionQueue(listener: RejectionHandler): void {
  const process = globalThis.process
  if (!posthogGlobal[NEXT_REJECTION_FILTER] || typeof process.rawListeners !== 'function') {
    return
  }
  if (!process.rawListeners('unhandledRejection').includes(listener)) {
    return
  }
  // Next patches the methods on the process object itself, so the prototype's removeListener still reaches the
  // process's real listener list.
  const removeListener = Object.getPrototypeOf(process).removeListener as NodeJS.Process['removeListener']
  removeListener.call(process, 'unhandledRejection', listener)
  if (!process.listeners('unhandledRejection').includes(listener)) {
    process.prependListener('unhandledRejection', listener)
  }
}

function installListeners(state: AutocaptureState): () => void {
  const process = globalThis.process
  const removals: (() => void)[] = []
  const listen = (event: string, listener: (...args: any[]) => void): void => {
    process.on(event, listener)
    removals.push(() => process.removeListener(event, listener))
  }

  if (state.mode === 'strict') {
    // Strict mode raises the rejection as an uncaught exception before any unhandledRejection listener runs, and the
    // process exits right after.
    listen('uncaughtExceptionMonitor', (error: Error, origin: NodeJS.UncaughtExceptionOrigin) =>
      captureUncaughtException(state, error, origin, true)
    )
    return () => removals.forEach((remove) => remove())
  }

  listen('uncaughtException', makeUncaughtExceptionHandler(state))

  // In throw and warn-with-error-code modes, any unhandledRejection listener stops Node's default handling (the
  // escalation to uncaughtException, or the warning and exit code). We listen only while the host has a listener of
  // its own, which has already stopped that handling, so the SDK never changes what Node does with the rejection.
  // Bun never escalates a rejection, so there we always listen and reproduce its exit when no host listener is left.
  const replacesDefaultHandling = state.mode === 'throw' || state.mode === 'warn-with-error-code'
  const followsHostListeners = replacesDefaultHandling && !process.versions?.bun
  const isInstalled = (): boolean => process.listeners('unhandledRejection').includes(listener)
  const listener = makeUnhandledRejectionHandler(state, replacesDefaultHandling, isInstalled)

  // Ours runs before the host's listeners, so that it sees them as they were when the rejection was emitted.
  const keepFirst = (): void => {
    const raw = typeof process.rawListeners === 'function' ? process.rawListeners('unhandledRejection') : []
    if (raw.includes(listener) && raw[0] !== listener) {
      process.removeListener('unhandledRejection', listener)
      process.prependListener('unhandledRejection', listener)
    }
  }

  // newListener is emitted before the host listener is added, so ours is in place for the next rejection. Adding ours
  // back here also recovers from a host that cleared every listener with removeAllListeners.
  listen(
    'newListener',
    markListener((event: string | symbol, added: unknown) => {
      if (isPostHogListener(added)) {
        return
      }
      if (event === 'unhandledRejection') {
        if (!isInstalled()) {
          process.prependListener('unhandledRejection', listener)
        }
        queueMicrotask(() => {
          keepFirst()
          joinHostRejectionQueue(listener)
        })
      } else if (event === NEXT_LISTENER_EVENT) {
        // Once Next's process.on has queued the host listener, ours joins the same queue if it is not there.
        queueMicrotask(() => {
          if (!isInstalled()) {
            process.prependListener('unhandledRejection', listener)
          }
        })
      }
    })
  )

  if (!followsHostListeners) {
    process.prependListener('unhandledRejection', listener)
  } else {
    // removeListener is emitted after the removal. Without a host listener, ours would stop Node's default handling.
    listen(
      'removeListener',
      markListener((event: string | symbol) => {
        if (event === 'unhandledRejection' && isInstalled() && !hasHostUnhandledRejectionListener(process)) {
          process.removeListener('unhandledRejection', listener)
        }
      })
    )
    if (hasHostUnhandledRejectionListener(process)) {
      process.prependListener('unhandledRejection', listener)
    }
  }
  joinHostRejectionQueue(listener)
  removals.push(() => {
    process.removeListener('unhandledRejection', listener)
    if (typeof process.rawListeners === 'function' && process.rawListeners('unhandledRejection').includes(listener)) {
      const removeListener = Object.getPrototypeOf(process).removeListener as NodeJS.Process['removeListener']
      removeListener.call(process, 'unhandledRejection', listener)
    }
  })
  return () => removals.forEach((remove) => remove())
}

/**
 * Captures uncaught exceptions and unhandled rejections for a client, through one set of process listeners shared by
 * every client in the process. Returns a function the client calls on shutdown. The listeners stay for the life of
 * the process, as they always have, and the last client of a project keeps capturing after it shuts down until
 * another client of the project starts.
 */
export function startExceptionAutocapture(
  client: AutocaptureClient,
  mode: UnhandledRejectionMode = STARTUP_UNHANDLED_REJECTION_MODE
): () => void {
  if (!globalThis.process?.on) {
    return () => undefined
  }

  let state = posthogGlobal[STATE_KEY]
  if (!state) {
    const created: AutocaptureState = {
      mode,
      clients: new Set(),
      retired: new Map(),
      capturedThisTurn: new Map(),
      deferred: new Set(),
      turnResetScheduled: false,
      calledFatalError: false,
      removeListeners: () => undefined,
    }
    created.removeListeners = installListeners(created)
    posthogGlobal[STATE_KEY] = created
    state = created
  }
  state.clients.add(client)
  state.retired.delete(client.key)

  const activeState = state
  return () => {
    if (!activeState.clients.delete(client)) {
      return
    }
    if (![...activeState.clients].some((other) => other.key === client.key)) {
      activeState.retired.set(client.key, client)
    }
  }
}

/**
 * Records an error passed to captureException, and reports whether to capture it: false when autocapture already sent
 * this error to the project during this turn. Otherwise the app's capture wins, and autocapture skips the error for the
 * project for the rest of the turn. The same occurrence comes both ways when a framework hands an error from its own
 * process listener to an error hook that calls captureException (Nitro's error hook, which @posthog/nuxt captures),
 * and when an app captures an error and rethrows it. A capture of the same error object in a later turn is a new
 * occurrence.
 */
export function claimExplicitCapture(error: unknown, key: string): boolean {
  const state = posthogGlobal[STATE_KEY]
  if (!state) {
    return true
  }
  if (state.capturedThisTurn.get(error)?.get(key) === 'autocapture') {
    return false
  }
  recordCapture(state, error, key, 'app')
  findDeferred(state, error)?.skipKeys.add(key)
  return true
}

/** @internal Removes the shared listeners and forgets every client, for tests. */
export function resetExceptionAutocapture(): void {
  const state = posthogGlobal[STATE_KEY]
  if (state) {
    state.deferred.clear()
    state.removeListeners()
    delete posthogGlobal[STATE_KEY]
  }
}
