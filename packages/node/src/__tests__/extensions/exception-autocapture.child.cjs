const { PostHog } = require('../../../dist/entrypoints/index.node.js')

const scenario = process.argv[2]
const withSdk = process.argv[3] === 'with-sdk'

let priorOnceListener
let priorUnhandledOnceListener
let monitorRemovedListener
if (scenario === 'unhandled-rejection-listener') {
  process.on('unhandledRejection', (reason) => {
    process.stdout.write(`unhandled-listener:${reason.message}\n`)
  })
} else if (scenario === 'removed-prior-unhandled-once-listener') {
  priorUnhandledOnceListener = (reason) => {
    process.stdout.write(`once-listener:${reason.message}\n`)
  }
  process.once('unhandledRejection', priorUnhandledOnceListener)
} else if (scenario === 'uncaught-exception-listener') {
  process.on('uncaughtException', (error, origin) => {
    process.stdout.write(`uncaught-listener:${origin}:${error.message}\n`)
  })
} else if (
  scenario === 'prior-uncaught-once-listener' ||
  scenario === 'removed-prior-uncaught-once-listener'
) {
  priorOnceListener = (error, origin) => {
    process.stdout.write(`once-listener:${origin}:${error.message}\n`)
  }
  process.once('uncaughtException', priorOnceListener)
} else if (scenario === 'later-monitor-removes-uncaught-listener') {
  monitorRemovedListener = (error, origin) => {
    process.stdout.write(`monitor-removed-listener:${origin}:${error.message}\n`)
  }
  process.once('uncaughtException', monitorRemovedListener)
}

const posthog = withSdk
  ? new PostHog('api_key', {
      enableExceptionAutocapture: true,
    })
  : undefined

if (posthog) {
  posthog._capturePreparedEvent = (event) => {
    const exception = event.properties.$exception_list[0]
    process.stdout.write(`posthog-capture:${exception.mechanism.type}:${exception.value}\n`)
    return Promise.resolve()
  }
}

if (scenario === 'later-monitor-adds-uncaught-listener') {
  process.on('uncaughtExceptionMonitor', () => {
    process.prependOnceListener('uncaughtException', (error, origin) => {
      process.stdout.write(`monitor-added-listener:${origin}:${error.message}\n`)
    })
  })
} else if (monitorRemovedListener) {
  process.on('uncaughtExceptionMonitor', () => {
    process.removeListener('uncaughtException', monitorRemovedListener)
  })
} else if (priorUnhandledOnceListener) {
  process.removeListener('unhandledRejection', priorUnhandledOnceListener)
} else if (scenario === 'removed-prior-uncaught-once-listener' && priorOnceListener) {
  process.removeListener('uncaughtException', priorOnceListener)
} else if (
  scenario === 'later-unhandled-prepend-once-listener' ||
  scenario === 'removed-later-unhandled-once-listener'
) {
  const listener = (reason) => {
    process.stdout.write(`once-listener:${reason.message}\n`)
  }
  process.prependOnceListener('unhandledRejection', listener)
  if (scenario === 'removed-later-unhandled-once-listener') {
    process.removeListener('unhandledRejection', listener)
  }
} else if (scenario === 'later-uncaught-prepend-once-listener') {
  process.prependOnceListener('uncaughtException', (error, origin) => {
    process.stdout.write(`once-listener:${origin}:${error.message}\n`)
  })
} else if (scenario === 'late-domain-uncaught-exception-clear-listener') {
  process.on('uncaughtException', function domainUncaughtExceptionClear() {})
}

setTimeout(async () => {
  await posthog?.shutdown()
  process.stdout.write('completed\n')
}, 50)

const error = new Error('Child process rejection')
if (
  scenario === 'later-uncaught-prepend-once-listener' ||
  scenario === 'later-monitor-adds-uncaught-listener' ||
  scenario === 'later-monitor-removes-uncaught-listener' ||
  scenario === 'late-domain-uncaught-exception-clear-listener'
) {
  throw error
}
Promise.reject(error)
