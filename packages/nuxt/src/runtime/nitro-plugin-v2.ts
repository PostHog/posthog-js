import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import { setupPostHogNitroPlugin } from './nitro-plugin'

export default defineNitroPlugin((nitroApp) => {
  setupPostHogNitroPlugin({
    useRuntimeConfig,
    onError: handler =>
      nitroApp.hooks.hook('error', (error, { event }) =>
        handler(error, event ? { path: event.path, method: event.method } : undefined),
      ),
    onClose: handler => nitroApp.hooks.hook('close', handler),
  })
})
