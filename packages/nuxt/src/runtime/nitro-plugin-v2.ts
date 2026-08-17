// Import via the `#imports` virtual module, not bare 'nitropack/runtime': that subpath
// only exists in nitropack >= 2.9.5 (guaranteed from Nuxt 3.12), so value-importing it
// breaks our declared Nuxt >= 3.7 floor — unresolved at build time, then
// ERR_PACKAGE_PATH_NOT_EXPORTED when the packed server starts. `#imports` resolves to
// Nitro's own runtime exports on every Nitro 2 version, and defineNitroPlugin is an
// identity function, so a typed plain export is equivalent.
import { useRuntimeConfig } from '#imports'
import type { NitroAppPlugin } from 'nitropack'
import { setupPostHogNitroPlugin } from './nitro-plugin'

const posthogNitroPlugin: NitroAppPlugin = (nitroApp) => {
  setupPostHogNitroPlugin({
    useRuntimeConfig,
    onError: handler =>
      nitroApp.hooks.hook('error', (error, { event }) =>
        handler(error, event ? { path: event.path, method: event.method } : undefined),
      ),
    onClose: handler => nitroApp.hooks.hook('close', handler),
  })
}

export default posthogNitroPlugin
