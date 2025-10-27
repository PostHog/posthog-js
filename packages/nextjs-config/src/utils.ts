import nextPackage from 'next/package.json' with { type: 'json' }
import semver from 'semver'
import { PostHogNextConfigComplete } from './config'
import { spawnLocal } from '@posthog/core/process'
import nextJS from 'next/package.json'

export function getNextJsVersion(): string {
  return nextPackage.version
}

export function hasCompilerHook(): boolean {
  const nextJsVersion = getNextJsVersion()
  return semver.gte(nextJsVersion, '15.4.1')
}

export async function processSourceMaps(posthogOptions: PostHogNextConfigComplete, directory: string) {
  const cliOptions = []
  if (posthogOptions.host) {
    cliOptions.push('--host', posthogOptions.host)
  }
  cliOptions.push('sourcemap', 'process')
  cliOptions.push('--directory', directory)
  if (posthogOptions.sourcemaps.project) {
    cliOptions.push('--project', posthogOptions.sourcemaps.project)
  }
  if (posthogOptions.sourcemaps.version) {
    cliOptions.push('--version', posthogOptions.sourcemaps.version)
  }
  if (posthogOptions.sourcemaps.deleteAfterUpload) {
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

async function callPosthogCli(args: string[], env: NodeJS.ProcessEnv, verbose: boolean): Promise<void> {
  await spawnLocal('posthog-cli', args, {
    env,
    stdio: verbose ? 'inherit' : 'ignore',
    onBinaryFound: (binaryPath) => {
      console.log(`running posthog-cli binary from ${binaryPath}`)
    },
    resolveFrom: __dirname,
    cwd: process.cwd(),
  })
}

// Helper to detect if Turbopack is enabled
export function isTurbopackEnabled(): boolean {
  // CLI flag (--turbo/--turbopack) injects TURBOPACK=1 at runtime
  return process.env.TURBOPACK === '1' || (isTurbopackDefault() && !(process.env.WEBPACK === '1'))
}

function isTurbopackDefault(): boolean {
  const [major] = nextJS.version.split('.')
  return Number(major) >= 16
}
