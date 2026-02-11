import nextPackage from 'next/package.json' with { type: 'json' }
import semver from 'semver'

import { spawnLocal } from '@posthog/core/process'
import { ResolvedPluginConfig } from '@posthog/webpack-plugin'

export function getNextJsVersion(): string {
  return nextPackage.version
}

export function hasCompilerHook(): boolean {
  const nextJsVersion = getNextJsVersion()
  return semver.gte(nextJsVersion, '15.4.1')
}

export async function processSourceMaps(posthogOptions: ResolvedPluginConfig, directory: string) {
  const cliOptions = []
  cliOptions.push('sourcemap', 'process')
  cliOptions.push('--directory', directory)

  if (posthogOptions.sourcemaps.releaseName) {
    cliOptions.push('--release-name', posthogOptions.sourcemaps.releaseName)
  }

  if (posthogOptions.sourcemaps.releaseVersion) {
    cliOptions.push('--release-version', posthogOptions.sourcemaps.releaseVersion)
  }

  if (posthogOptions.sourcemaps.deleteAfterUpload) {
    cliOptions.push('--delete-after')
  }

  if (posthogOptions.sourcemaps.batchSize) {
    cliOptions.push('--batch-size', posthogOptions.sourcemaps.batchSize.toString())
  }

  const logLevel = `posthog_cli=${posthogOptions.logLevel}`
  // Add env variables
  const envVars = {
    ...process.env,
    RUST_LOG: logLevel,
    POSTHOG_CLI_HOST: posthogOptions.host,
    POSTHOG_CLI_API_KEY: posthogOptions.personalApiKey,
    POSTHOG_CLI_PROJECT_ID: posthogOptions.projectId,
  }
  await callPosthogCli(posthogOptions.cliBinaryPath, cliOptions, envVars)
}

async function callPosthogCli(binaryPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await spawnLocal(binaryPath, args, {
    env,
    stdio: 'inherit',
    cwd: process.cwd(),
  })
}

// Helper to detect if Turbopack is enabled
export function isTurbopackEnabled(): boolean {
  // CLI flag (--turbo/--turbopack) injects TURBOPACK=1 at runtime
  return process.env.TURBOPACK === '1' || (isTurbopackDefault() && !(process.env.WEBPACK === '1'))
}

function isTurbopackDefault(): boolean {
  const nextJsVersion = getNextJsVersion()
  return semver.gte(nextJsVersion, '16.0.0')
}
