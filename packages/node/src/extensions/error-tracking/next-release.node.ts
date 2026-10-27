import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const MAX_CONFIG_BYTES = 2 * 1024 * 1024

/**
 * Next compiles `config.env` into application code, but an externalized posthog-node cannot
 * see that replacement. Read the build's own serialized config before the SDK captures errors.
 * This is Node-only; the Edge entrypoint must never import the filesystem.
 */
export function getNextBuildReleaseId(): string | undefined {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return undefined

  try {
    const standaloneConfig = process.env.__NEXT_PRIVATE_STANDALONE_CONFIG
    const config = standaloneConfig
      ? JSON.parse(standaloneConfig)
      : (() => {
          const file = path.join(process.cwd(), '.next', 'required-server-files.json')
          const stat = statSync(file)
          if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return undefined
          return JSON.parse(readFileSync(file, 'utf8')).config
        })()
    const releaseId = config?.env?.POSTHOG_RELEASE_ID
    return typeof releaseId === 'string' ? releaseId.trim() || undefined : undefined
  } catch {
    // The build manifest is optional (e.g. custom deployments); exception capture must not fail.
    return undefined
  }
}
