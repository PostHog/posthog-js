import { platform, release } from 'node:os'

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
  return {
    ...(osName ? { 'os.name': osName } : {}),
    ...(osVersion ? { 'os.version': osVersion } : {}),
  }
}
