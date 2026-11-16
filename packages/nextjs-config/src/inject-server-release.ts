import fs from 'node:fs/promises'
import path from 'node:path'

const RUNTIMES = ['server/chunks/[turbopack]_runtime.js', 'server/chunks/ssr/[turbopack]_runtime.js']
const MARKER = '/* posthog-server-release */'
const SOURCE_MAPPING_URL_COMMENT = /^[ \t]*\/\/# sourceMappingURL=[^\r\n]*$/gm

/**
 * Turbopack externalizes posthog-node, so its `process.env.POSTHOG_RELEASE_ID` is not
 * replaced by Next's build-time env. Its unversioned server runtime is evaluated before
 * loading route chunks, giving the external SDK the same global as our webpack runtime module.
 * Do not modify content-addressed server chunks or browser assets after compilation.
 */
export async function injectServerRelease(distDir: string, releaseId: string): Promise<void> {
  let found = false
  for (const runtime of RUNTIMES) {
    const filename = path.join(distDir, runtime)
    let code: string
    try {
      code = await fs.readFile(filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    found = true
    if (code.includes(MARKER)) {
      if (!code.includes(`${MARKER}${JSON.stringify(releaseId)}`)) {
        throw new Error(`PostHog: ${runtime} already has a different release ID`)
      }
      continue
    }
    const snippet = `${MARKER}${JSON.stringify(releaseId)};try { globalThis._posthogReleaseId = globalThis._posthogReleaseId || ${JSON.stringify(releaseId)}; } catch (_) {}\n`
    // Insert after executable code, but ahead of the trailing sourcemap URL. Existing
    // source positions (and the debug IDs in other chunks) remain unchanged.
    const comments = [...code.matchAll(SOURCE_MAPPING_URL_COMMENT)]
    const position = comments.at(-1)?.index ?? code.length
    const prefix = code.slice(0, position)
    await fs.writeFile(filename, prefix + (prefix.endsWith('\n') ? '' : '\n') + snippet + code.slice(position))
  }
  if (!found) throw new Error('PostHog: Next.js did not emit a Turbopack server runtime for release injection')
}
