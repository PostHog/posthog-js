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
  // Sends what the client holds, without waiting for rejections in their grace period.
  drain: () => Promise<void>
  // Sends what the client still holds. Called before a fatal exit.
  shutdown: () => Promise<void>
  // The client's waitUntil option: keeps a serverless runtime alive until the promise settles.
  keepAlive?: (promise: Promise<unknown>) => void
}

type ContextRunner = <T>(run: () => T) => T

type AsyncHooksModule = { AsyncLocalStorage?: { snapshot?: () => ContextRunner } }

// Captures the async context the error happened in: every AsyncLocalStorage, so the request context of each client
// and the active OpenTelemetry span. A capture made later runs in it, and so reports that request and that span, or
// none, never those of whatever code triggered the capture.
function snapshotAsyncContext(): ContextRunner {
  try {
    const process = globalThis.process as { getBuiltinModule?: (id: string) => unknown } | undefined
    const asyncHooks = process?.getBuiltinModule?.('node:async_hooks') as AsyncHooksModule | undefined
    const snapshot = asyncHooks?.AsyncLocalStorage?.snapshot?.()
    if (snapshot) {
      return snapshot
    }
  } catch {
    // A runtime without AsyncLocalStorage.snapshot has nothing to restore.
  }
  return (run) => run()
}

const UNHANDLED_REJECTION_HINT: CoreErrorTracking.EventHint = {
  mechanism: { type: 'onunhandledrejection', handled: false },
}
const UNCAUGHT_EXCEPTION_HINT: CoreErrorTracking.EventHint = {
  mechanism: { type: 'onuncaughtexception', handled: false },
}

// How long a rejection stays unhandled before it is captured. Code that starts a request early and awaits it later
// (the prefetch pattern Next.js recommends) attaches its handler moments after Node reports the rejection, and Node
// then emits 'rejectionHandled'.
export const UNHANDLED_REJECTION_GRACE_MS = 1000

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

type PendingRejection = {
  reason: unknown
  timer: ReturnType<typeof setTimeout>
  // The event-loop turn in which Node reported the rejection.
  turn: number
  // Runs the capture in the async context the rejection happened in.
  runInContext: ContextRunner
  // Projects that already received it: through captureException, or from a client that shut down during the grace
  // period.
  capturedKeys: Set<string>
  // The clients that captured it, which a flush on another client of the same project also drains.
  owners: Set<AutocaptureClient>
  // Settles once the rejection is captured or handled.
  settled: Promise<void>
  settle: () => void
}

type AutocaptureState = {
  mode: UnhandledRejectionMode
  clients: Set<AutocaptureClient>
  // The last client of each project that shut down. It keeps capturing until another client of the project starts,
  // as the listeners of a shut-down client always did, so that a client per request still captures between requests.
  retired: Map<string, AutocaptureClient>
  // Rejections waiting out their grace period.
  pending: Map<Promise<unknown>, PendingRejection>
  // Next.js 16 can hand one rejection to the same listener twice.
  seenRejections: WeakSet<Promise<unknown>>
  // The projects each reason was captured for during this turn of the event loop, and the client that captured it. A
  // host that rethrows a rejection, or a runtime that reports it twice, delivers the same reason again before the
  // turn ends. Primitives compare by value. A separate occurrence of the same error object comes in a later turn and
  // is captured again.
  capturedThisTurn: Map<unknown, Map<string, AutocaptureClient | undefined>>
  // The projects each error reached through captureException during this turn. An app that captures an error and
  // rethrows it hands autocapture the same occurrence.
  capturedByAppThisTurn: Map<unknown, Set<string>>
  turn: number
  turnResetScheduled: boolean
  calledFatalError: boolean
  // One keep-alive per client with the waitUntil option, however many rejections are pending.
  keepAliveCycles: Map<AutocaptureClient, Promise<void>>
  rejectionHandledListener: PostHogListener & ((promise: Promise<unknown>) => void)
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

function addKey(map: Map<unknown, Set<string>>, exception: unknown, key: string): void {
  const keys = map.get(exception) ?? new Set<string>()
  keys.add(key)
  map.set(exception, keys)
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
      state.capturedByAppThisTurn.clear()
      state.turn++
      state.turnResetScheduled = false
    })
    deferredReset.unref?.()
  })
  reset.unref?.()
}

type DispatchOptions = {
  // Captures through these clients instead of one per project.
  targets?: AutocaptureClient[]
  skipKeys?: Set<string>
  // Set for a pending rejection, which is deduplicated by its promise: two rejections with the same primitive reason
  // in one turn are still two occurrences.
  ignoreTurn?: boolean
}

// Sends the exception to every project once, unless this occurrence already reached it, or the app captured the error
// itself in this turn (it caught, captured and rethrew it).
// Returns the clients that captured it.
function dispatch(
  state: AutocaptureState,
  exception: unknown,
  hint: CoreErrorTracking.EventHint,
  { targets = captureTargets(state), skipKeys, ignoreTurn }: DispatchOptions = {}
): AutocaptureClient[] {
  if (isFrameworkControlFlow(exception)) {
    return []
  }
  const capturedThisTurn = state.capturedThisTurn.get(exception) ?? new Map<string, AutocaptureClient | undefined>()
  const capturedByApp = state.capturedByAppThisTurn.get(exception)
  const owners: AutocaptureClient[] = []

  for (const client of targets) {
    if (skipKeys?.has(client.key) || (!ignoreTurn && capturedThisTurn.has(client.key))) {
      continue
    }
    if (capturedByApp?.has(client.key)) {
      continue
    }
    capturedThisTurn.set(client.key, client)
    client.capture(exception, hint)
    owners.push(client)
  }

  state.capturedThisTurn.set(exception, capturedThisTurn)
  scheduleTurnReset(state)
  return owners
}

// Node prints PromiseRejectionHandledWarning, with the rejection's id, only when no listener takes 'rejectionHandled'.
// So we listen only while a rejection waits out its grace period.
function syncRejectionHandledListener(state: AutocaptureState): void {
  const process = globalThis.process
  const listening = process.listeners('rejectionHandled').includes(state.rejectionHandledListener)
  if (state.pending.size > 0 && !listening) {
    process.on('rejectionHandled', state.rejectionHandledListener)
  } else if (state.pending.size === 0 && listening) {
    process.removeListener('rejectionHandled', state.rejectionHandledListener)
  }
}

// forClient: capture through this client only, because it is shutting down. The rejection stays pending for the other
// projects.
function capturePendingRejection(
  state: AutocaptureState,
  promise: Promise<unknown>,
  forClient?: AutocaptureClient
): void {
  const pending = state.pending.get(promise)
  if (!pending) {
    return
  }
  const owners = pending.runInContext(() =>
    dispatch(state, pending.reason, UNHANDLED_REJECTION_HINT, {
      targets: forClient ? [forClient] : undefined,
      skipKeys: pending.capturedKeys,
      ignoreTurn: true,
    })
  )
  for (const owner of owners) {
    pending.owners.add(owner)
  }
  if (forClient) {
    pending.capturedKeys.add(forClient.key)
    return
  }
  clearTimeout(pending.timer)
  state.pending.delete(promise)
  pending.settle()
  syncRejectionHandledListener(state)
}

function capturePendingRejections(state: AutocaptureState, forClient?: AutocaptureClient): void {
  for (const promise of [...state.pending.keys()]) {
    capturePendingRejection(state, promise, forClient)
  }
}

async function exitAfterFatalError(state: AutocaptureState, error: unknown): Promise<void> {
  console.error(error)
  // Rejections still in their grace period would go down with the process.
  capturePendingRejections(state)
  const clients = new Set([...state.clients, ...state.retired.values()])
  await Promise.all([...clients].map((client) => client.shutdown().catch(() => undefined)))
  globalThis.process.exit(1)
}

function captureUncaughtException(
  state: AutocaptureState,
  error: unknown,
  origin: NodeJS.UncaughtExceptionOrigin
): void {
  for (const [promise, pending] of state.pending) {
    if (pending.reason !== error) {
      continue
    }
    const sameTurn = pending.turn === state.turn
    capturePendingRejection(state, promise)
    // A host listener rethrew the rejection while Node reported it: one occurrence, and it was a rejection.
    if (sameTurn) {
      return
    }
    // The same error object thrown again in a later turn, still within the rejection's grace period: two occurrences.
    state.capturedThisTurn.delete(error)
    break
  }
  dispatch(state, error, origin === 'unhandledRejection' ? UNHANDLED_REJECTION_HINT : UNCAUGHT_EXCEPTION_HINT)
}

function makeUncaughtExceptionHandler(state: AutocaptureState): ErrorHandler {
  return markListener((error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
    const process = globalThis.process
    // Like Sentry, we only consider listeners that are currently registered. We intentionally do not reconstruct
    // participation by once listeners or listeners added or removed during dispatch.
    const userProvidedListenersCount = process.listeners('uncaughtException').filter((listener) => {
      return listener.name !== 'domainUncaughtExceptionClear' && !isPostHogListener(listener)
    }).length

    captureUncaughtException(state, error, origin)

    if (!state.calledFatalError && userProvidedListenersCount === 0) {
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

function wasCapturedThisTurn(state: AutocaptureState, exception: unknown): boolean {
  const keys = state.capturedThisTurn.get(exception)
  return keys !== undefined && captureTargets(state).every((client) => keys.has(client.key))
}

// Marks an exception as handled for this turn without capturing it, so the uncaught-exception handler skips it too.
function skipThisTurn(state: AutocaptureState, exception: unknown): void {
  state.capturedThisTurn.set(exception, new Map(captureTargets(state).map((client) => [client.key, undefined])))
  scheduleTurnReset(state)
}

// No host listener is left, but ours still runs: the host's listener went away without a removeListener event (Bun
// never emits one), or the runtime does not escalate rejections at all (Bun again). Our listener has stopped the
// runtime's default handling, so do what the runtime would have done without it.
function applyDefaultRejectionHandling(
  state: AutocaptureState,
  reason: unknown,
  promise: Promise<unknown>,
  ignored: boolean
): void {
  const process = globalThis.process
  if (state.mode === 'warn-with-error-code') {
    process.emitWarning(`Unhandled promise rejection: ${String(reason)}`, 'UnhandledPromiseRejectionWarning')
    process.exitCode = 1
    if (!ignored) {
      deferRejection(state, reason, promise)
    }
    return
  }

  if (process.versions?.bun) {
    // Bun exits on an unhandled rejection without emitting uncaughtException.
    if (!ignored) {
      dispatch(state, reason, UNHANDLED_REJECTION_HINT)
    }
    if (!state.calledFatalError) {
      state.calledFatalError = true
      void exitAfterFatalError(state, reason)
    }
    return
  }

  // Node escalates the rejection to the uncaught-exception listeners, with the origin 'unhandledRejection'. Ours is one
  // of them: it skips the capture made here, and exits unless the app handles uncaught exceptions itself.
  const escalated = toUnhandledRejectionError(reason)
  if (ignored) {
    skipThisTurn(state, escalated)
  } else {
    dispatch(state, escalated, UNHANDLED_REJECTION_HINT)
  }
  const emit = process.emit as (event: string, ...args: unknown[]) => boolean
  emit.call(process, 'uncaughtExceptionMonitor', escalated, 'unhandledRejection')
  emit.call(process, 'uncaughtException', escalated, 'unhandledRejection')
}

function deferRejection(state: AutocaptureState, reason: unknown, promise: Promise<unknown>): void {
  const timer = setTimeout(() => capturePendingRejection(state, promise), UNHANDLED_REJECTION_GRACE_MS)
  timer.unref?.()
  let settle = (): void => undefined
  const settled = new Promise<void>((resolve) => (settle = resolve))
  state.pending.set(promise, {
    reason,
    timer,
    turn: state.turn,
    runInContext: snapshotAsyncContext(),
    // An async function that captured the error and then threw it: the explicit capture came first, in this turn.
    capturedKeys: new Set(state.capturedByAppThisTurn.get(reason)),
    owners: new Set(),
    settled,
    settle,
  })
  for (const client of state.clients) {
    keepAliveUntilSent(state, client)
  }
  syncRejectionHandledListener(state)
  // Ends the turn, so that a later throw of the same reason is told apart from a rethrow.
  scheduleTurnReset(state)
}

// replacesDefaultHandling: in throw and warn-with-error-code modes, an unhandledRejection listener replaces the
// runtime's default handling, so ours must reproduce it when it is the only one left.
function makeUnhandledRejectionHandler(
  state: AutocaptureState,
  replacesDefaultHandling: boolean,
  isInstalled: () => boolean
): RejectionHandler {
  const listener = markListener((reason: unknown, promise: Promise<unknown>): void => {
    if (isWeakKey(promise)) {
      if (state.seenRejections.has(promise)) {
        return
      }
      state.seenRejections.add(promise)
    }
    const ignored = isAbortError(reason)
    // Our listener runs first, so a host listener that is gone now was not there when the rejection was emitted, unless
    // ours went with it: a once listener, or one that removes itself, takes ours along through the removeListener
    // handler, and the emit still calls ours from its copy of the list.
    if (replacesDefaultHandling && !hasHostUnhandledRejectionListener(globalThis.process) && isInstalled()) {
      applyDefaultRejectionHandling(state, reason, promise, ignored)
      return
    }
    // Bun reports a host's rethrow as an uncaught exception before our rejection listener runs.
    if (ignored || wasCapturedThisTurn(state, reason)) {
      return
    }
    if (!isWeakKey(promise)) {
      dispatch(state, reason, UNHANDLED_REJECTION_HINT)
      return
    }
    deferRejection(state, reason, promise)
  })
  return listener
}

function makeRejectionHandledHandler(state: AutocaptureState): PostHogListener & ((promise: Promise<unknown>) => void) {
  return markListener((promise: Promise<unknown>): void => {
    const pending = state.pending.get(promise)
    if (pending) {
      clearTimeout(pending.timer)
      state.pending.delete(promise)
      pending.settle()
    }
    // Node prints this warning when no listener takes the event, and ours would otherwise silence it. Node's own text
    // also names the rejection's id, which it does not expose.
    const process = globalThis.process
    if (process.listeners('rejectionHandled').every(isPostHogListener)) {
      process.emitWarning('Promise rejection was handled asynchronously', 'PromiseRejectionHandledWarning')
    }
    syncRejectionHandledListener(state)
  })
}

// A serverless runtime would otherwise freeze the instance before a pending rejection is captured and sent. One
// keep-alive per client covers every rejection pending for it, including those that arrive while it waits.
function keepAliveUntilSent(state: AutocaptureState, client: AutocaptureClient): void {
  if (!client.keepAlive || state.keepAliveCycles.has(client)) {
    return
  }
  const cycle = (async () => {
    while (pendingFor(state, client).length > 0) {
      await waitForPendingRejections(client)
    }
    await client.drain()
  })()
    .catch(() => undefined)
    .finally(() => state.keepAliveCycles.delete(client))
  state.keepAliveCycles.set(client, cycle)
  client.keepAlive(cycle)
}

function pendingFor(state: AutocaptureState, client: AutocaptureClient): PendingRejection[] {
  return [...state.pending.values()].filter((pending) => !pending.capturedKeys.has(client.key))
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
    // Strict mode raises the rejection as an uncaught exception before any unhandledRejection listener runs.
    listen('uncaughtExceptionMonitor', (error: Error, origin: NodeJS.UncaughtExceptionOrigin) =>
      captureUncaughtException(state, error, origin)
    )
    return () => removals.forEach((remove) => remove())
  }

  listen('uncaughtException', makeUncaughtExceptionHandler(state))
  // A process that ends on its own does not wait for the grace period's timer. Sending them keeps it alive until they
  // are out.
  listen(
    'beforeExit',
    markListener(() => {
      if (state.pending.size === 0) {
        return
      }
      capturePendingRejections(state)
      for (const client of captureTargets(state)) {
        client.drain().catch(() => undefined)
      }
    })
  )
  removals.push(() => process.removeListener('rejectionHandled', state.rejectionHandledListener))

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
      pending: new Map(),
      seenRejections: new WeakSet(),
      capturedThisTurn: new Map(),
      capturedByAppThisTurn: new Map(),
      keepAliveCycles: new Map(),
      turn: 0,
      turnResetScheduled: false,
      calledFatalError: false,
      rejectionHandledListener: markListener(() => undefined),
      removeListeners: () => undefined,
    }
    created.rejectionHandledListener = makeRejectionHandledHandler(created)
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
    if ([...activeState.clients].some((other) => other.key === client.key)) {
      return
    }
    activeState.retired.set(client.key, client)
    // The client is shutting down, and would otherwise send these only after it finished.
    capturePendingRejections(activeState, client)
  }
}

/**
 * Waits until every rejection in its grace period that this client's project has not received yet is captured or
 * handled, at most the grace period, then sends what other clients of the project captured. A flush of this client
 * that follows sends the rest, before a serverless runtime freezes or ends the instance. Sending them early instead
 * would report rejections the app was about to handle.
 */
export async function waitForPendingRejections(client: AutocaptureClient): Promise<void> {
  const state = posthogGlobal[STATE_KEY]
  if (!state) {
    return
  }
  const waiting = pendingFor(state, client)
  await Promise.all(waiting.map((pending) => pending.settled))
  const owners = new Set(waiting.flatMap((pending) => [...pending.owners]))
  owners.delete(client)
  await Promise.all([...owners].map((owner) => owner.drain().catch(() => undefined)))
}

/**
 * Sends the event autocapture made for this error in this turn, when captureException skipped it as a duplicate.
 * captureExceptionImmediate promises the exception is sent when it resolves, and an app's uncaught-exception
 * listener often exits right after.
 */
export async function sendAutocapturedEvent(error: unknown, key: string): Promise<void> {
  const owner = posthogGlobal[STATE_KEY]?.capturedThisTurn.get(error)?.get(key)
  await owner?.drain()
}

/**
 * Records an error passed to captureException, and reports whether to capture it. Frameworks hand errors from their own
 * process listeners to an error hook, and an integration then passes them to captureException (Nitro's error hook,
 * which @posthog/nuxt captures), so both paths carry the same occurrence:
 * - False when autocapture sent this error to the project during this turn.
 * - A rejection still in its grace period is reported by this capture, and autocapture then skips the project.
 * A capture of the same error object in a later turn is a new occurrence.
 */
export function claimExplicitCapture(error: unknown, key: string): boolean {
  const state = posthogGlobal[STATE_KEY]
  if (!state) {
    return true
  }
  if (state.capturedThisTurn.get(error)?.has(key)) {
    return false
  }
  for (const pending of state.pending.values()) {
    if (pending.reason === error) {
      pending.capturedKeys.add(key)
    }
  }
  addKey(state.capturedByAppThisTurn, error, key)
  scheduleTurnReset(state)
  return true
}

/** @internal Removes the shared listeners and forgets every client, for tests. */
export function resetExceptionAutocapture(): void {
  const state = posthogGlobal[STATE_KEY]
  if (state) {
    for (const { timer, settle } of state.pending.values()) {
      clearTimeout(timer)
      settle()
    }
    state.removeListeners()
    delete posthogGlobal[STATE_KEY]
  }
}
