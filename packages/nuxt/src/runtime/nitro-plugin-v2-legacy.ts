// Nitro 2 adapter for installs whose nitropack lacks the bare 'nitropack/runtime' subpath
// (nitropack < 2.9.5, possible on Nuxt < 3.11.2), where the import used by nitro-plugin-v2
// does not resolve (unresolved at build time, ERR_PACKAGE_PATH_NOT_EXPORTED at server
// startup). Deep subpaths like
// 'nitropack/runtime/config' resolve but old Nitro externalizes them, so they crash at
// runtime on nitro's build-time-only '#internal/nitro/virtual/*' specifiers. The
// `#imports` virtual module is the one mechanism that works on every old Nitro 2 version
// (it is what this module shipped with before the adapter split), and defineNitroPlugin
// is an identity function, so a typed plain export is equivalent.
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
