const { PostHog } = require('../../../dist/entrypoints/index.node.js')

const scenario = process.argv[2]
const withSdk = process.argv[3] === 'with-sdk'

function logRejection(reason) {
  process.stdout.write(`unhandled-listener:${reason.message}\n`)
}

function rethrowRejection(reason) {
  process.stdout.write(`rethrowing-listener:${reason.message}\n`)
  throw reason
}

if (
  scenario === 'unhandled-rejection-listener' ||
  scenario === 'removed-unhandled-rejection-listener' ||
  scenario === 'late-handled-rejection' ||
  scenario === 'many-clients' ||
  scenario === 'exits-without-shutdown' ||
  scenario === 'client-per-request' ||
  scenario === 'flush-then-exit'
) {
  process.on('unhandledRejection', logRejection)
} else if (scenario === 'rethrowing-unhandled-rejection-listener') {
  process.on('unhandledRejection', rethrowRejection)
} else if (scenario === 'once-listener-before-init') {
  process.once('unhandledRejection', logRejection)
} else if (scenario === 'self-removing-listener-before-init') {
  process.on('unhandledRejection', function removeItself(reason) {
    process.removeListener('unhandledRejection', removeItself)
    logRejection(reason)
  })
} else if (scenario === 'uncaught-exception-listener') {
  process.on('uncaughtException', (error, origin) => {
    process.stdout.write(`uncaught-listener:${origin}:${error.message}\n`)
  })
} else if (scenario === 'mutated-node-options') {
  process.env.NODE_OPTIONS = '--unhandled-rejections=warn'
} else if (scenario === 'mutated-exec-argv') {
  process.execArgv.push('--unhandled-rejections=warn')
}

const clients = withSdk
  ? Array.from(
      { length: scenario === 'many-clients' ? 3 : scenario === 'flush-second-client-in-uncaught-listener' ? 2 : 1 },
      () => new PostHog('api_key', { enableExceptionAutocapture: true })
    )
  : []
const posthog = clients[0]

function printCapture(event) {
  const exception = event.properties.$exception_list[0]
  process.stdout.write(`posthog-capture:${exception.mechanism.type}:${exception.value}\n`)
  return Promise.resolve()
}

for (const client of clients) {
  client._capturePreparedEvent = printCapture
  client.captureImmediate = printCapture
}

if (scenario === 'late-unhandled-rejection-listener') {
  process.on('unhandledRejection', logRejection)
} else if (scenario === 'late-rethrowing-unhandled-rejection-listener') {
  process.on('unhandledRejection', rethrowRejection)
} else if (scenario === 'removed-unhandled-rejection-listener') {
  process.removeListener('unhandledRejection', logRejection)
} else if (scenario === 'string-rethrowing-unhandled-rejection-listener') {
  process.on('unhandledRejection', (reason) => {
    process.stdout.write(`rethrowing-listener:${reason}\n`)
    throw reason
  })
} else if (scenario === 'immediate-capture-in-uncaught-listener') {
  // Added after init, so it runs after the SDK's listener. Its own capture still wins over autocapture.
  process.on('uncaughtException', async (error) => {
    await posthog?.captureExceptionImmediate(error)
    process.stdout.write('exiting\n')
    process.exit(0)
  })
} else if (scenario === 'shutdown-in-uncaught-listener') {
  // The usual way to send what is queued before a crash: shut the client down, then exit.
  process.on('uncaughtException', async () => {
    await posthog?.shutdown()
    process.stdout.write('exiting\n')
    process.exit(1)
  })
} else if (scenario === 'flush-in-uncaught-listener') {
  process.on('uncaughtException', async () => {
    await posthog?.flush()
    process.stdout.write('exiting\n')
    process.exit(1)
  })
} else if (scenario === 'flush-second-client-in-uncaught-listener') {
  // Two clients for one project, and the crash handler flushes the one that is not the project's first.
  process.on('uncaughtException', async () => {
    await clients[1]?.flush()
    process.stdout.write('exiting\n')
    process.exit(1)
  })
} else if (scenario === 'repeated-string-throws') {
  // Keeps the process alive through uncaught exceptions, so an idle job can throw the same string again.
  process.on('uncaughtException', () => undefined)
} else if (scenario === 'shutdown-in-rejection-listener') {
  process.on('unhandledRejection', async () => {
    await posthog?.shutdown()
    process.stdout.write('exiting\n')
    process.exit(1)
  })
} else if (scenario === 'error-hook-listener') {
  // Like Nitro: the host's listener hands the rejection to an error hook, which an integration passes to
  // captureException a microtask later.
  process.on('unhandledRejection', (reason) => {
    logRejection(reason)
    queueMicrotask(() => posthog?.captureException(reason))
  })
}

if (scenario !== 'exits-without-shutdown' && scenario !== 'flush-then-exit') {
  process.once('beforeExit', async () => {
    await Promise.all(clients.map((client) => client.shutdown()))
    process.stdout.write('completed\n')
  })
}

if (
  scenario === 'immediate-capture-in-uncaught-listener' ||
  scenario === 'shutdown-in-uncaught-listener' ||
  scenario === 'flush-in-uncaught-listener' ||
  scenario === 'flush-second-client-in-uncaught-listener'
) {
  setTimeout(() => {
    throw new Error('Child process exception')
  }, 10)
} else if (scenario === 'repeated-string-throws') {
  // Nothing else wakes the event loop between the throws.
  for (const delay of [100, 300, 500]) {
    setTimeout(() => {
      throw 'tick'
    }, delay)
  }
} else if (scenario === 'flush-then-exit') {
  // The end of a serverless invocation: flush, then the runtime freezes or ends the instance.
  Promise.reject(new Error('Child process rejection'))
  setTimeout(() => posthog?.flush().then(() => process.exit(0)) ?? process.exit(0), 20)
} else if (scenario === 'client-per-request') {
  // The request's client shuts down before the rejection lands.
  Promise.resolve(posthog?.shutdown()).then(() =>
    setTimeout(() => Promise.reject(new Error('Child process rejection')), 20)
  )
} else if (scenario === 'late-handled-rejection') {
  const rejection = Promise.reject(new Error('Child process rejection'))
  setTimeout(() => rejection.catch(() => process.stdout.write('handled-late\n')), 20)
} else if (scenario === 'string-rethrowing-unhandled-rejection-listener') {
  Promise.reject('Child process rejection')
} else {
  Promise.reject(new Error('Child process rejection'))
}
