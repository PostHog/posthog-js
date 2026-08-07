import { definePlugin } from 'nitro'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { setupPostHogNitroPlugin } from './nitro-plugin'

export default definePlugin((nitroApp) => {
  setupPostHogNitroPlugin({
    useRuntimeConfig,
    onError: handler =>
      nitroApp.hooks.hook('error', (error, { event }) =>
        handler(error, event ? { path: new URL(event.req.url).pathname, method: event.req.method } : undefined),
      ),
    onClose: (handler) => {
      let shutdown
      const close = () => (shutdown ??= handler())
      nitroApp.hooks.hook('close', close)
      globalThis.process?.once?.('beforeExit', close)
    },
  })
})
