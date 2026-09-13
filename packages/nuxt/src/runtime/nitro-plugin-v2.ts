import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import { setupPostHogNitroPlugin } from './nitro-plugin'

export default defineNitroPlugin((nitroApp) => {
  setupPostHogNitroPlugin({
    useRuntimeConfig,
    onError: (handler) =>
      nitroApp.hooks.hook('error', (error, { event }) => {
        let path
        if (event) {
          try {
            // Prefix origin-form targets to preserve leading double slashes as part of the path.
            const url = event.path.startsWith('/') ? `http://localhost${event.path}` : event.path
            path = new URL(url, 'http://localhost').pathname
          } catch {
            // A malformed request URL must not prevent capturing the original exception.
          }
        }
        return handler(error, event ? { path, method: event.method } : undefined)
      }),
    onClose: (handler) => nitroApp.hooks.hook('close', handler),
  })
})
