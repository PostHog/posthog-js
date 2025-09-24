import { PostHog } from '../../../dist/entrypoints/index.node.mjs'
import { parentPort } from 'worker_threads'

const posthog = new PostHog('api_key', {
  enableExceptionAutocapture: true,
})

parentPort.on('message', (msg) => {
  if (msg.action == 'throw_error') {
    throw new Error(msg.data)
  } else if (msg.action == 'reject_promise') {
    Promise.resolve().then(() => {
      throw new Error(msg.data)
    })
  } else {
    console.error('Unrecognized message from main thread:', msg)
  }
})

await new Promise((res) => {
  posthog.capture = (event) => {
    event.distinctId = 'stable_id'
    parentPort.postMessage({ method: 'capture', event })
    res()
  }
})

await posthog.shutdown()
