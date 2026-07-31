// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import type { EventEmitter } from 'events'

type PostHogErrorHandler = { _posthogErrorHandler: boolean }
type ErrorHandler = PostHogErrorHandler & NodeJS.UncaughtExceptionListener
type RejectionHandler = PostHogErrorHandler & ((reason: unknown) => void)
type UnhandledRejectionMode = 'throw' | 'strict' | 'warn' | 'warn-with-error-code' | 'none'

const UNHANDLED_REJECTION_OPTION_NAMES = ['--unhandled-rejections', '--unhandled_rejections']
const UNHANDLED_REJECTION_MODES = new Set<UnhandledRejectionMode>([
  'throw',
  'strict',
  'warn',
  'warn-with-error-code',
  'none',
])

function splitNodeOptions(nodeOptions: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: "'" | '"' | undefined
  let escaped = false

  for (const character of nodeOptions) {
    if (escaped) {
      current += character
      escaped = false
    } else if (character === '\\' && quote !== "'") {
      escaped = true
    } else if (quote) {
      if (character === quote) {
        quote = undefined
      } else {
        current += character
      }
    } else if (character === "'" || character === '"') {
      quote = character
    } else if (/\s/.test(character)) {
      if (current) {
        args.push(current)
        current = ''
      }
    } else {
      current += character
    }
  }

  if (escaped) {
    current += '\\'
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
  execArgv: string[] = globalThis.process?.execArgv ?? [],
  nodeOptions: string | undefined = globalThis.process?.env.NODE_OPTIONS
): UnhandledRejectionMode {
  // Command-line arguments take precedence over NODE_OPTIONS, and the last occurrence wins within each source.
  return (
    findUnhandledRejectionMode(execArgv) ?? findUnhandledRejectionMode(splitNodeOptions(nodeOptions ?? '')) ?? 'throw'
  )
}

function isPostHogErrorHandler(listener: unknown): boolean {
  return (
    typeof listener === 'function' &&
    (listener as unknown as Partial<PostHogErrorHandler>)._posthogErrorHandler === true
  )
}

function isUserProvidedListener(listener: unknown, eventName: 'uncaughtException' | 'unhandledRejection'): boolean {
  return (
    typeof listener === 'function' &&
    !isPostHogErrorHandler(listener) &&
    !(eventName === 'uncaughtException' && listener.name === 'domainUncaughtExceptionClear')
  )
}

function processHasUserProvidedUncaughtExceptionListener(process: NodeJS.Process): boolean {
  return process
    .listeners('uncaughtException')
    .some((listener) => isUserProvidedListener(listener, 'uncaughtException'))
}

function makeUncaughtExceptionHandler(
  captureFn: (exception: Error, hint: CoreErrorTracking.EventHint) => void,
  onFatalFn: (exception: Error) => void,
  processWouldExit: () => boolean
): ErrorHandler {
  let calledFatalError: boolean = false

  return Object.assign(
    (error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
      captureFn(error, {
        mechanism: {
          type: origin === 'unhandledRejection' ? 'onunhandledrejection' : 'onuncaughtexception',
          handled: false,
        },
      })

      if (!calledFatalError && processWouldExit()) {
        calledFatalError = true
        onFatalFn(error)
      }
    },
    { _posthogErrorHandler: true }
  )
}

export function addUncaughtExceptionListener(
  captureFn: (exception: Error, hint: CoreErrorTracking.EventHint) => void,
  onFatalFn: (exception: Error) => void
): void {
  const process = globalThis.process
  if (!process) {
    return
  }

  let userListenerParticipated = (): boolean => false
  const handler = makeUncaughtExceptionHandler(
    captureFn,
    onFatalFn,
    () => !userListenerParticipated() && !processHasUserProvidedUncaughtExceptionListener(process)
  )
  process.prependListener('uncaughtException', handler)
  userListenerParticipated = trackUserListenerParticipation(process, 'uncaughtException')
}

function emitUnhandledRejectionWarning(reason: unknown): void {
  const warning = reason instanceof Error ? reason.stack || reason.message : String(reason)
  globalThis.process?.emitWarning(warning, 'UnhandledPromiseRejectionWarning')
  globalThis.process?.emitWarning(
    'Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch().',
    'UnhandledPromiseRejectionWarning'
  )
}

type EventListener = Parameters<EventEmitter['on']>[1]
type ParticipationMarker = PostHogErrorHandler & (() => void)

function trackUserListenerParticipation(
  process: NodeJS.Process,
  eventName: 'uncaughtException' | 'unhandledRejection'
): () => boolean {
  const emitter: EventEmitter = process
  const markersByListener = new Map<EventListener, ParticipationMarker[]>()
  let userListenerParticipated = false

  emitter.on('newListener', (addedEventName, listener) => {
    if (addedEventName !== eventName || !isUserProvidedListener(listener, eventName)) {
      return
    }

    const marker = Object.assign(
      () => {
        userListenerParticipated = true
      },
      { _posthogErrorHandler: true }
    )
    const markers = markersByListener.get(listener) ?? []
    markers.push(marker)
    markersByListener.set(listener, markers)

    // newListener runs before Node inserts the listener. Prepending here makes a prepended user listener land directly
    // before its marker. If that once listener removes itself during dispatch, EventEmitter's cloned listener array still
    // contains and invokes the marker before the PostHog handler.
    emitter.prependOnceListener(eventName, marker)
  })

  emitter.on('removeListener', (removedEventName, listener) => {
    if (removedEventName !== eventName || !isUserProvidedListener(listener, eventName)) {
      return
    }

    const markers = markersByListener.get(listener)
    const marker = markers?.pop()
    if (markers?.length === 0) {
      markersByListener.delete(listener)
    }
    if (marker) {
      // Explicit removal happens before a future dispatch (including from uncaughtExceptionMonitor), so its marker must
      // not claim that the removed listener participated. Auto-removal by once happens during dispatch, after the array
      // was cloned, and therefore the cloned marker still runs.
      emitter.removeListener(eventName, marker)
    }
  })

  return () => {
    const participated = userListenerParticipated
    userListenerParticipated = false
    return participated
  }
}

function makeUnhandledRejectionHandler(
  captureFn: (exception: unknown, hint: CoreErrorTracking.EventHint) => void,
  mode: Exclude<UnhandledRejectionMode, 'throw' | 'strict'>,
  userListenerParticipated: () => boolean
): RejectionHandler {
  return Object.assign(
    (reason: unknown): void => {
      const hasUserProvidedListener =
        userListenerParticipated() ||
        global.process.listeners('unhandledRejection').some((listener) => !isPostHogErrorHandler(listener))

      captureFn(reason, {
        mechanism: {
          type: 'onunhandledrejection',
          handled: false,
        },
      })

      if (mode === 'warn-with-error-code' && !hasUserProvidedListener) {
        // Installing our listener suppresses Node's warning and exit code in this mode. Recreate both without forcing
        // an immediate exit, allowing the process to finish naturally just as Node normally would.
        globalThis.process.exitCode = 1
        emitUnhandledRejectionWarning(reason)
      }
    },
    { _posthogErrorHandler: true }
  )
}

export function addUnhandledRejectionListener(
  captureFn: (exception: unknown, hint: CoreErrorTracking.EventHint) => void,
  mode: UnhandledRejectionMode = getUnhandledRejectionMode()
): void {
  const process = globalThis.process
  if (!process || mode === 'throw' || mode === 'strict') {
    return
  }

  let userListenerParticipated = (): boolean => false
  const handler = makeUnhandledRejectionHandler(captureFn, mode, () => userListenerParticipated())
  process.prependListener('unhandledRejection', handler)

  if (mode === 'warn-with-error-code') {
    userListenerParticipated = trackUserListenerParticipation(process, 'unhandledRejection')
  }
}
