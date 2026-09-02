import { platform, release } from 'node:os'
import { osResourceAttributes } from '@posthog/core'

/**
 * OTLP `os.name` / `os.version` for the machine running the SDK, so spans can
 * be filtered by platform (e.g. "only the Linux workers") in PostHog.
 *
 * Node-only, like the other `.node` modules: importing `node:os` from a shared
 * module would put it in the edge bundle. A failed read omits the key rather
 * than throwing out of client construction.
 */
export function hostOsResourceAttributes(): Record<string, string> {
  let osName: string | undefined
  let osVersion: string | undefined
  try {
    osName = platform()
    osVersion = release()
  } catch {}
  // Through the shared builder, so a Node span reports the same `os.name` the
  // browser, iOS and Android SDKs send rather than the `node:os` identifier.
  return osResourceAttributes(osName, osVersion)
}
