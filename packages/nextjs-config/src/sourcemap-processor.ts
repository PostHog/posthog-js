import type { PostHogNextConfigComplete } from './types'
import { callPosthogCli } from './utils'

/**
 * Process sourcemaps in a directory by injecting and uploading them
 */
export async function processSourcemaps(
  directory: string,
  posthogOptions: PostHogNextConfigComplete,
  isServer: boolean
): Promise<void> {
  try {
    // Run inject
    await runInject(directory, posthogOptions)

    // Run upload
    await runUpload(directory, posthogOptions, isServer)

    if (posthogOptions.verbose) {
      console.log(`PostHog: Successfully processed sourcemaps in ${directory}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`Error processing PostHog sourcemaps in ${directory}:`, errorMessage)
    if (posthogOptions.sourcemaps.failOnError) {
      throw error
    }
    // Continue silently if failOnError is false
  }
}

async function runInject(directory: string, posthogOptions: PostHogNextConfigComplete): Promise<void> {
  const cliOptions = ['sourcemap', 'inject', '--directory', directory]
  await callPosthogCli(cliOptions, process.env, posthogOptions.verbose)
}

async function runUpload(
  directory: string,
  posthogOptions: PostHogNextConfigComplete,
  isServer: boolean
): Promise<void> {
  const cliOptions = []

  if (posthogOptions.host) {
    cliOptions.push('--host', posthogOptions.host)
  }

  cliOptions.push('sourcemap', 'upload')
  cliOptions.push('--directory', directory)

  if (posthogOptions.sourcemaps.project) {
    cliOptions.push('--project', posthogOptions.sourcemaps.project)
  }

  if (posthogOptions.sourcemaps.version) {
    cliOptions.push('--version', posthogOptions.sourcemaps.version)
  }

  // Only delete sourcemaps after upload for client builds. Server sourcemaps are retained to avoid unintended data loss or for debugging purposes.
  if (posthogOptions.sourcemaps.deleteAfterUpload && !isServer) {
    cliOptions.push('--delete-after')
  }

  // Add env variables
  const envVars = {
    ...process.env,
    POSTHOG_CLI_TOKEN: posthogOptions.personalApiKey,
    POSTHOG_CLI_ENV_ID: posthogOptions.envId,
  }

  await callPosthogCli(cliOptions, envVars, posthogOptions.verbose)
}
