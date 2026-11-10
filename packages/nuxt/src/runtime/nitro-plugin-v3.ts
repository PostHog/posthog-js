import { definePlugin } from 'nitro'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { setupPostHogNitroPlugin } from './nitro-plugin'

export default definePlugin((nitroApp) => {
  setupPostHogNitroPlugin({
    useRuntimeConfig,
    wrapRequest: (wrapper) => {
      const handler = nitroApp.fetch
      nitroApp.fetch = (request) =>
        wrapper(
          {
            source: request,
            path: request.url,
            method: request.method,
            headers: request.headers,
          },
          () => handler(request)
        )
    },
    onError: (handler) =>
      nitroApp.hooks.hook('error', (error, { event }) =>
        handler(
          error,
          event
            ? {
                source: event.req,
                path: event.req.url,
                method: event.req.method,
              }
            : undefined
        )
      ),
    onClose: (handler) => nitroApp.hooks.hook('close', handler),
  })
})
