const { PostHog } = require('../../../dist/entrypoints/index.node.js')

const scenario = process.argv[2]
const withSdk = process.argv[3] === 'with-sdk'

if (scenario === 'unhandled-rejection-listener') {
  process.on('unhandledRejection', (reason) => {
    process.stdout.write(`unhandled-listener:${reason.message}\n`)
  })
} else if (scenario === 'uncaught-exception-listener') {
  process.on('uncaughtException', (error, origin) => {
    process.stdout.write(`uncaught-listener:${origin}:${error.message}\n`)
  })
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

setTimeout(async () => {
  await posthog?.shutdown()
  process.stdout.write('completed\n')
}, 50)

Promise.reject(new Error('Child process rejection'))
