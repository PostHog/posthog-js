import { definePlugin } from 'nitro'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { setupPostHogNitroPlugin } from './nitro-plugin'

export default definePlugin((nitroApp) => {
  setupPostHogNitroPlugin({
    useRuntimeConfig,
    onError: (handler) =>
      nitroApp.hooks.hook('error', (error, { event }) =>
        handler(
          error,
          event
            ? {
                path: event.req.url,
                method: event.req.method,
              }
            : undefined
        )
      ),
    onClose: (handler) => nitroApp.hooks.hook('close', handler),
  })
})
