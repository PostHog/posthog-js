import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import { setupPostHogNitroPlugin } from './nitro-plugin'

export default defineNitroPlugin((nitroApp) => {
  setupPostHogNitroPlugin({
    useRuntimeConfig,
    wrapRequest: (wrapper) => {
      const handler = nitroApp.h3App.handler
      nitroApp.h3App.handler = (event) =>
        wrapper(
          {
            source: event,
            path: event.path,
            method: event.method,
            headers: event.node.req.headers,
          },
          () => handler(event)
        )
    },
    onError: (handler) =>
      nitroApp.hooks.hook('error', (error, { event }) =>
        handler(error, event ? { source: event, path: event.path, method: event.method } : undefined)
      ),
    onClose: (handler) => nitroApp.hooks.hook('close', handler),
  })
})
