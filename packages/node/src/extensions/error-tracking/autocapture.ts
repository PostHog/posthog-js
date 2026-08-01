// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

import { ErrorTracking as CoreErrorTracking } from '@posthog/core'

type ErrorHandler = { _posthogErrorHandler: boolean } & NodeJS.UncaughtExceptionListener
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
  execArgv: string[] = globalThis.process?.execArgv ?? [],
  nodeOptions: string | undefined = globalThis.process?.env.NODE_OPTIONS
): UnhandledRejectionMode {
  // Command-line arguments take precedence over NODE_OPTIONS, and the last occurrence wins within each source.
  return (
    findUnhandledRejectionMode(execArgv) ?? findUnhandledRejectionMode(splitNodeOptions(nodeOptions ?? '')) ?? 'throw'
  )
}

function makeUncaughtExceptionHandler(
  captureFn: (exception: Error, hint: CoreErrorTracking.EventHint) => void,
  onFatalFn: (exception: Error) => void
): ErrorHandler {
  let calledFatalError: boolean = false

  return Object.assign(
    (error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
      // Like Sentry, we only consider listeners that are currently registered. We intentionally do not reconstruct
      // participation by once listeners or listeners added or removed during dispatch.
      const userProvidedListenersCount = global.process.listeners('uncaughtException').filter((listener) => {
        return (
          listener.name !== 'domainUncaughtExceptionClear' &&
          (listener as Partial<ErrorHandler>)._posthogErrorHandler !== true
        )
      }).length

      captureFn(error, {
        mechanism: {
          type: origin === 'unhandledRejection' ? 'onunhandledrejection' : 'onuncaughtexception',
          handled: false,
        },
      })

      if (!calledFatalError && userProvidedListenersCount === 0) {
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
  globalThis.process?.on('uncaughtException', makeUncaughtExceptionHandler(captureFn, onFatalFn))
}

export function addUnhandledRejectionListener(
  captureFn: (exception: unknown, hint: CoreErrorTracking.EventHint) => void,
  mode: UnhandledRejectionMode = getUnhandledRejectionMode()
): void {
  const process = globalThis.process

  // Installing an unhandledRejection listener changes Node's behavior in these modes. We intentionally skip capture
  // rather than reproducing Node's fatal handling or warn-with-error-code warning and exit-code semantics in the SDK.
  if (!process || mode === 'throw' || mode === 'strict' || mode === 'warn-with-error-code') {
    return
  }

  process.on('unhandledRejection', (reason: unknown) => {
    captureFn(reason, {
      mechanism: {
        type: 'onunhandledrejection',
        handled: false,
      },
    })
  })
}
