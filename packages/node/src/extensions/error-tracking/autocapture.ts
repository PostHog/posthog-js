// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

import { ErrorTracking as CoreErrorTracking } from '@posthog/core'

type PostHogListener = { _posthogErrorHandler: boolean }
type ErrorHandler = PostHogListener & NodeJS.UncaughtExceptionListener
type RejectionHandler = PostHogListener & NodeJS.UnhandledRejectionListener
type CaptureFn = (exception: unknown, hint: CoreErrorTracking.EventHint) => void
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

function isPostHogListener(listener: unknown): boolean {
  return typeof listener === 'function' && (listener as Partial<PostHogListener>)._posthogErrorHandler === true
}

function isWeakKey(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function hasHostUnhandledRejectionListener(process: NodeJS.Process): boolean {
  return process.listeners('unhandledRejection').some((listener) => !isPostHogListener(listener))
}

function captureUncaughtException(
  captureFn: CaptureFn,
  error: Error,
  origin: NodeJS.UncaughtExceptionOrigin,
  capturedRejections: WeakSet<object>
): void {
  // A host unhandledRejection listener can rethrow a reason the SDK already captured, and Node then reports it again here.
  if (isWeakKey(error) && capturedRejections.delete(error)) {
    return
  }

  captureFn(error, {
    mechanism: {
      type: origin === 'unhandledRejection' ? 'onunhandledrejection' : 'onuncaughtexception',
      handled: false,
    },
  })
}

function makeUncaughtExceptionHandler(
  captureFn: CaptureFn,
  onFatalFn: (exception: Error) => void,
  capturedRejections: WeakSet<object>
): ErrorHandler {
  let calledFatalError: boolean = false

  return Object.assign(
    (error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
      // Like Sentry, we only consider listeners that are currently registered. We intentionally do not reconstruct
      // participation by once listeners or listeners added or removed during dispatch.
      const userProvidedListenersCount = global.process.listeners('uncaughtException').filter((listener) => {
        return listener.name !== 'domainUncaughtExceptionClear' && !isPostHogListener(listener)
      }).length

      captureUncaughtException(captureFn, error, origin, capturedRejections)

      if (!calledFatalError && userProvidedListenersCount === 0) {
        calledFatalError = true
        onFatalFn(error)
      }
    },
    { _posthogErrorHandler: true }
  )
}

function makeUnhandledRejectionHandler(captureFn: CaptureFn, capturedRejections: WeakSet<object>): RejectionHandler {
  return Object.assign(
    (reason: unknown): void => {
      if (isWeakKey(reason)) {
        capturedRejections.add(reason)
      }

      captureFn(reason, {
        mechanism: {
          type: 'onunhandledrejection',
          handled: false,
        },
      })
    },
    { _posthogErrorHandler: true }
  )
}

export function addUncaughtExceptionListener(
  captureFn: CaptureFn,
  onFatalFn: (exception: Error) => void,
  mode: UnhandledRejectionMode = STARTUP_UNHANDLED_REJECTION_MODE,
  capturedRejections: WeakSet<object> = new WeakSet()
): void {
  const process = globalThis.process
  if (!process) {
    return
  }

  if (mode === 'strict') {
    process.on('uncaughtExceptionMonitor', (error, origin) =>
      captureUncaughtException(captureFn, error, origin, capturedRejections)
    )
    return
  }

  process.on('uncaughtException', makeUncaughtExceptionHandler(captureFn, onFatalFn, capturedRejections))
}

export function addUnhandledRejectionListener(
  captureFn: CaptureFn,
  mode: UnhandledRejectionMode = STARTUP_UNHANDLED_REJECTION_MODE,
  capturedRejections: WeakSet<object> = new WeakSet()
): void {
  const process = globalThis.process

  // Strict mode raises the rejection as an uncaught exception before any unhandledRejection listener runs, and the
  // uncaught-exception monitor captures it there.
  if (!process || mode === 'strict') {
    return
  }

  const listener = makeUnhandledRejectionHandler(captureFn, capturedRejections)

  if (mode === 'warn' || mode === 'none') {
    process.on('unhandledRejection', listener)
    return
  }

  // In throw and warn-with-error-code modes, any unhandledRejection listener stops Node's default handling (the
  // escalation to uncaughtException, or the warning and exit code). We listen only while the host has a listener of
  // its own, which has already stopped that handling, so the SDK never changes what Node does with the rejection.
  const isInstalled = (): boolean => process.listeners('unhandledRejection').includes(listener)

  // newListener is emitted before the host listener is added, so ours runs first and is in place for the next rejection.
  process.on('newListener', (event: string | symbol, added: unknown) => {
    if (event === 'unhandledRejection' && !isPostHogListener(added) && !isInstalled()) {
      process.on('unhandledRejection', listener)
    }
  })

  // removeListener is emitted after the removal. Without a host listener, ours would stop Node's default handling.
  process.on('removeListener', (event: string | symbol) => {
    if (event === 'unhandledRejection' && isInstalled() && !hasHostUnhandledRejectionListener(process)) {
      process.removeListener('unhandledRejection', listener)
    }
  })

  if (hasHostUnhandledRejectionListener(process)) {
    process.on('unhandledRejection', listener)
  }
}

export function addExceptionAutocaptureListeners(
  captureFn: CaptureFn,
  onFatalFn: (exception: Error) => void,
  mode: UnhandledRejectionMode = STARTUP_UNHANDLED_REJECTION_MODE
): void {
  // Shared so that a rejection captured by the unhandledRejection listener is not captured again as an uncaught exception.
  const capturedRejections = new WeakSet<object>()
  addUncaughtExceptionListener(captureFn, onFatalFn, mode, capturedRejections)
  addUnhandledRejectionListener(captureFn, mode, capturedRejections)
}
