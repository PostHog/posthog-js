import { PostHogNextConfigComplete } from './config'
import * as path from 'path'
import * as fs from 'fs'
import { processSourcemaps } from './sourcemap-processor'

/**
 * Process sourcemaps for Turbopack builds
 * This is called by the runAfterProductionCompile hook
 */
export async function processTurbopackSourcemaps(
  posthogOptions: PostHogNextConfigComplete,
  distDir?: string
): Promise<void> {
  const resolvedDistDir = path.resolve(process.cwd(), distDir ?? '.next')

  // Process both server and client sourcemaps
  const serverDir = path.join(resolvedDistDir, 'server')
  const clientDir = path.join(resolvedDistDir, 'static/chunks')

  // Check if directories exist
  const serverExists = fs.existsSync(serverDir)
  const clientExists = fs.existsSync(clientDir)

  if (serverExists) {
    await processSourcemaps(serverDir, posthogOptions, true)
  }

  if (clientExists) {
    await processSourcemaps(clientDir, posthogOptions, false)
  }

  if (!serverExists && !clientExists && posthogOptions.verbose) {
    console.log('PostHog: No build directories found, skipping sourcemap processing')
  }
}
